import { getMpToken } from '@/utils/file'

const isCfPage = import.meta.env.CF_PAGES === `1`
const isDev = import.meta.env.DEV
export async function getMpAccessToken() {
  let { appID, appsecret, proxyOrigin } = JSON.parse(
    localStorage.getItem(`mpConfig`)!,
  )
  // 未填写代理域名且是cfpages环境
  if (!proxyOrigin && isCfPage) {
    proxyOrigin = window.location.origin
  }
  // 开发环境，走本地代理配置
  if (isDev) {
    proxyOrigin = ``
  }
  const access_token = await getMpToken(appID, appsecret, proxyOrigin)
  return access_token
}
