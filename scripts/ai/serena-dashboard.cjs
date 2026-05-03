#!/usr/bin/env node

// Serena Dashboard 地址查询脚本。
// 使用场景：
// - 开发者想主动打开 dashboard，但 MCP server 没有自动弹浏览器。
// 设计原则：
// - 只读探测正在监听的 dashboard 端口，不启动 Serena，也不打开浏览器。
// - 如果未发现端口，给出 Serena 默认地址和端口递增规则。

const {
  getSerenaDashboardUrls,
  logInfo,
  logWarn
} = require('./gitnexus-utils.cjs')

function main() {
  const urls = getSerenaDashboardUrls()
  if (urls.length === 0) {
    logWarn('未发现正在监听的 Serena Dashboard。')
    console.log('[AI Context] MCP server 启动后默认可尝试：http://127.0.0.1:24282/dashboard/')
    console.log('[AI Context] 如果有多个 Serena 实例，端口可能递增为 24283、24284 等。')
    return
  }

  logInfo('当前可访问的 Serena Dashboard：')
  for (const url of urls) {
    console.log(`- ${url}`)
  }
}

main()
