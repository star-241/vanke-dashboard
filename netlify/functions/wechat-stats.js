/**
 * 微信公众号粉丝数据接口
 * 获取粉丝总数、新增、取关、净增等数据
 * 
 * 调用方式: GET /.netlify/functions/wechat-stats?days=7
 */

const APP_ID = process.env.WECHAT_APP_ID;
const APP_SECRET = process.env.WECHAT_APP_SECRET;

async function getAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APP_ID}&secret=${APP_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(`获取token失败: ${data.errmsg}`);
  return data.access_token;
}

function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// 获取粉丝数据（需要日期格式 YYYYMMDD）
async function getFollowerStats(accessToken, startDate, endDate) {
  const url = `https://api.weixin.qq.com/datacube/getusersummary?access_token=${accessToken}`;
  const body = { begin_date: startDate, end_date: endDate };
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`粉丝数据获取失败: ${data.errmsg}`);
  return data.list || [];
}

// 获取粉丝总数
async function getFollowerTotal(accessToken) {
  const url = `https://api.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(`获取粉丝总数失败: ${data.errmsg}`);
  return data.total;
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
        body: JSON.stringify({ error: '未配置 WECHAT_APP_ID 或 WECHAT_APP_SECRET 环境变量' })
      };
    }

    const days = parseInt(event.queryStringParameters?.days || '7');
    const accessToken = await getAccessToken();

    // 获取粉丝总数
    const totalFollowers = await getFollowerTotal(accessToken);

    // 获取近期粉丝趋势
    const endDate = formatDate(Date.now());
    const startDate = formatDate(Date.now() - days * 86400000);
    const followerTrend = await getFollowerStats(accessToken, startDate, endDate);

    // 计算汇总
    const summary = followerTrend.reduce((acc, item) => {
      acc.newFollowers += item.new_user;
      acc.cancelFollowers += item.cancel_user;
      return acc;
    }, { newFollowers: 0, cancelFollowers: 0 });

    summary.netGrowth = summary.newFollowers - summary.cancelFollowers;
    summary.totalFollowers = totalFollowers;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        summary: summary,
        trend: followerTrend.map(item => ({
          date: item.ref_date,
          newFollowers: item.new_user,
          cancelFollowers: item.cancel_user,
          netGrowth: item.new_user - item.cancel_user,
          // 关注来源（如果有）
          sources: item.wechat_ || null
        }))
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
