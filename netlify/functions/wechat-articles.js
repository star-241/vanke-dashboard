/**
 * 微信公众号文章数据接口
 * 获取已发布文章列表 + 阅读/点赞/分享/评论数据
 * 
 * 调用方式: GET /.netlify/functions/wechat-articles?days=7
 * days: 获取最近N天的文章，默认7天
 */

const APP_ID = process.env.WECHAT_APP_ID;
const APP_SECRET = process.env.WECHAT_APP_SECRET;

// 获取 access_token（每次请求重新获取，内部面板用量远低于2000次/天限制）
async function getAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APP_ID}&secret=${APP_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(`获取token失败: ${data.errmsg}`);
  return data.access_token;
}

// 获取图文素材列表
async function getArticles(accessToken, days = 7) {
  const startTime = Math.floor(Date.now() / 1000) - days * 86400;
  const url = `https://api.weixin.qq.com/cgi-bin/material/batchget_material?access_token=${accessToken}`;
  const body = {
    type: 'news',
    offset: 0,
    count: 20  // 一次最多20条
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`获取素材失败: ${data.errmsg}`);
  return data.item || [];
}

// 获取文章统计数据（阅读、分享、收藏）
async function getArticleStats(accessToken, startDate, endDate) {
  const url = `https://api.weixin.qq.com/datacube/getarticlesummary?access_token=${accessToken}`;
  const body = {
    begin_date: startDate,
    end_date: endDate
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode) {
    // 数据统计接口可能需要公众号有流量主权限，失败时返回空数组
    console.warn('统计数据获取失败:', data.errmsg);
    return [];
  }
  return data.list || [];
}

// 获取文章阅读来源明细
async function getArticleReadDetail(accessToken, startDate, endDate) {
  const url = `https://api.weixin.qq.com/datacube/getarticletotal?access_token=${accessToken}`;
  const body = {
    begin_date: startDate,
    end_date: endDate
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode) {
    console.warn('阅读明细获取失败:', data.errmsg);
    return [];
  }
  return data.list || [];
}

// 获取评论
async function getComments(accessToken, articleId, page = 1) {
  const url = `https://api.weixin.qq.com/cgi-bin/comment/list?access_token=${accessToken}`;
  const body = {
    msg_data_id: articleId,
    index: 0,
    begin: (page - 1) * 50,
    count: 50,
    type: 0  // 0=全部，1=精选
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode) {
    // 没有开通评论功能会报错，正常
    return { comments: [], total: 0, errmsg: data.errmsg };
  }
  return { comments: data.comment || [], total: data.total };
}

// 格式化日期 YYYY-MM-DD
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

exports.handler = async (event, context) => {
  // CORS
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
        body: JSON.stringify({ error: '未配置 WECHAT_APP_ID 或 WECHAT_APP_SECRET 环境变量' })
      };
    }

    const days = parseInt(event.queryStringParameters?.days || '7');
    const accessToken = await getAccessToken();

    // 获取文章列表
    const articles = await getArticles(accessToken, days);

    // 获取统计数据
    const endDate = formatDate(Date.now());
    const startDate = formatDate(Date.now() - days * 86400000);
    const statsList = await getArticleReadDetail(accessToken, startDate, endDate);

    // 组装数据
    const result = articles.map(item => {
      const news = item.content && item.content.news_item ? item.content.news_item[0] : {};
      const stats = statsList.find(s => s.msgid === item.media_id);
      
      return {
        mediaId: item.media_id,
        title: news.title || '未知标题',
        author: news.author || '',
        digest: news.digest || '',
        url: news.url || '',
        thumbUrl: news.thumb_url || '',
        updateTime: item.update_time,
        updateTimeStr: new Date(item.update_time * 1000).toLocaleString('zh-CN'),
        // 统计数据（如果有的话）
        readNum: stats ? stats.read_num : null,
        likeNum: stats ? stats.like_num : null,
        shareNum: stats ? stats.share_num : null,
        commentNum: stats ? stats.comment_num : null,
        // 阅读来源（如果有明细）
        readSource: stats && stats.read_channel_detail ? {
          session: stats.read_channel_detail.session_i,  // 会话
          history: stats.read_channel_detail.history_i,  // 历史消息
          feed: stats.read_channel_detail.feed_i,        // 朋友圈
          friends: stats.read_channel_detail.friends_i   // 好友分享
        } : null
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        total: result.length,
        articles: result,
        note: '统计数据需要公众号开通流量主权限；评论需要开通评论功能'
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
