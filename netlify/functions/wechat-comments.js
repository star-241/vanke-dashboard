/**
 * 微信公众号评论接口
 * 获取指定文章的评论列表，标记风险评论（含敏感词/负面情绪）
 * 
 * 调用方式: GET /.netlify/functions/wechat-comments?mediaId=xxx&articleIndex=0
 */

const APP_ID = process.env.WECHAT_APP_ID;
const APP_SECRET = process.env.WECHAT_APP_SECRET;

// 风险关键词（可扩展）
const RISK_KEYWORDS = [
  '投诉', '维权', '曝光', '欺骗', '诈骗', '虚假', '垃圾',
  '差评', '后悔', '坑人', '违规', '举报', '起诉',
  '质量差', '服务差', '态度差', '欺骗消费者'
];

async function getAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APP_ID}&secret=${APP_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(`获取token失败: ${data.errmsg}`);
  return data.access_token;
}

// 检测评论风险等级
function analyzeCommentRisk(comment) {
  const content = comment.content || '';
  let riskScore = 0;
  let riskTags = [];

  // 关键词匹配
  RISK_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword)) {
      riskScore += 30;
      riskTags.push(`含敏感词:"${keyword}"`);
    }
  });

  // 负面词检测
  const negativeWords = ['不', '没', '无', '差', '坏', '烂', '假', '骗'];
  const negativeCount = negativeWords.filter(w => content.includes(w)).length;
  if (negativeCount >= 2) {
    riskScore += 20;
    riskTags.push('负面情绪倾向');
  }

  // 感叹号/问号过多（情绪激烈）
  const punctuationCount = (content.match(/[！!？?]/g) || []).length;
  if (punctuationCount >= 3) {
    riskScore += 15;
    riskTags.push('情绪激烈');
  }

  // 长度过长（可能是刷屏/广告）
  if (content.length > 200) {
    riskScore += 10;
    riskTags.push('内容过长');
  }

  // 判断风险等级
  let riskLevel = 'safe';
  if (riskScore >= 60) riskLevel = 'high';
  else if (riskScore >= 30) riskLevel = 'medium';
  else if (riskScore > 0) riskLevel = 'low';

  return { riskScore, riskLevel, riskTags };
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (!APP_ID || !APP_SECRET) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: '未配置环境变量' })
      };
    }

    const mediaId = event.queryStringParameters?.mediaId;
    const articleIndex = parseInt(event.queryStringParameters?.articleIndex || '0');

    if (!mediaId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '缺少 mediaId 参数' })
      };
    }

    const accessToken = await getAccessToken();

    // 获取评论列表（最多取前100条）
    const url = `https://api.weixin.qq.com/cgi-bin/comment/list?access_token=${accessToken}`;
    const body = {
      msg_data_id: parseInt(mediaId),
      index: articleIndex,
      begin: 0,
      count: 50,
      type: 0  // 全部评论
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (data.errcode) {
      // 常见错误：没有开通评论功能
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          errcode: data.errcode,
          errmsg: data.errmsg,
          message: data.errcode === 88000 ? '该文章未开通评论功能' : 
                   data.errcode === 40001 ? 'access_token无效，请检查AppID/AppSecret' :
                   `接口错误: ${data.errmsg}`,
          comments: [],
          riskComments: []
        })
      };
    }

    // 分析评论风险
    const comments = (data.comment || []).map(c => {
      const risk = analyzeCommentRisk(c);
      return {
        id: c.user_comment_id,
        content: c.content,
        author: c.nick_name,
        avatar: c.head_url,
        likeNum: c.like_num,
        createTime: c.create_time,
        createTimeStr: new Date(c.create_time * 1000).toLocaleString('zh-CN'),
        isTop: c.is_top,
        isSelected: c.is_selected,
        risk: risk
      };
    });

    // 筛选出风险评论
    const riskComments = comments.filter(c => c.risk.riskLevel !== 'safe');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        total: comments.length,
        comments: comments,
        riskComments: riskComments,
        riskSummary: {
          high: riskComments.filter(c => c.risk.riskLevel === 'high').length,
          medium: riskComments.filter(c => c.risk.riskLevel === 'medium').length,
          low: riskComments.filter(c => c.risk.riskLevel === 'low').length
        }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
