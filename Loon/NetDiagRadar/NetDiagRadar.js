/**
 * 网络诊断雷达 · Loon 版
 * 由「网络诊断雷达」Surge 版改写而来，按 Loon 的能力做了三处替换：
 *   1) Surge 的 $surge.selectGroupDetails()  → Loon 的 $config.getConfig() / getSubPolicys()
 *   2) Surge 的 $httpClient { policy }        → Loon 的 $httpClient { node }
 *   3) 只写 $persistentStore + 通知          → 额外提供本地数据地址，小组件直接读
 *
 * 数据地址（小组件「快照地址」填这个）：
 *   http://1.1.1.1/radar/data        读缓存；?run=1 强制重测
 *   http://1.1.1.1/radar/run         立刻诊断并返回
 *   POST http://1.1.1.1/radar/opts   保存参数（body 为 JSON）
 *
 * 适配 Loon 3.5.1(983)+：插件用新语法 `cron ${cron} then script("x.js", {...})`，
 * 参数以对象形式进 $argument；旧式字符串 argument= 也兼容。
 *
 * 参数（插件 [Argument] / URL query / 已存参数均可）：
 *   node=节点或策略组   所有探测强制走它（Loon 的 node 参数支持 DIRECT / 节点 / 策略组）
 *   media=策略组名      流媒体专用
 *   ai=策略组名         AI 专用
 *   mask / ys           对 IP 打码
 *   notify              是否推送通知
 *   sync=https://…      POST 快照到该地址
 *   debug               详细日志
 */

const KEY_SNAPSHOT = 'radar.snapshot.v1'
const KEY_OPTS = 'radar.opts.v1'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// Loon 的 timeout 单位是毫秒（默认 5000），不是 Surge 的秒
const TIMEOUT = 8000
const CONCURRENCY = 6

const DEFAULT_OPTS = {
  node: '',
  media: '',
  ai: '',
  mask: false,
  notify: true,
  sync: '',
  debug: false,
}

const isRequest = typeof $request !== 'undefined' && $request && $request.url
const QUERY = isRequest ? parseQuery($request.url) : {}
const OPTS = buildOpts()

const MAINLAND_LATENCY_URLS = [
  'http://connect.rom.miui.com/generate_204',
  'http://wifi.vivo.com.cn/generate_204',
  'https://www.baidu.com/favicon.ico',
  'https://www.qq.com/favicon.ico',
]

const GLOBAL_LATENCY_URLS = [
  'https://cp.cloudflare.com/generate_204',
  'https://www.gstatic.com/generate_204',
  'https://www.google.com/generate_204',
]

const QUIC_TRACE_URLS = [
  'https://cloudflare-quic.com/cdn-cgi/trace',
  'https://cloudflare.com/cdn-cgi/trace',
]

const MEDIA_SERVICES = [
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/title/81215567' },
  { id: 'disney', name: 'Disney+', url: 'https://www.disneyplus.com/' },
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/' },
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/' },
  { id: 'prime', name: 'Prime', url: 'https://www.primevideo.com/' },
]

const AI_SERVICES = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/' },
]

const MEDIA_GROUP_CANDIDATES = ['流媒体', '流媒体解锁', 'Netflix', '媒体', '国际媒体', 'Streaming', 'Media', '解锁', '外网媒体']
const AI_GROUP_CANDIDATES = ['AI', 'AI服务', '人工智能', 'ChatGPT', 'OpenAI', '智能', 'AI 服务']


/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function diagnose() {
  const startedAt = Date.now()
  const state = readLoonState()
  const node = state.node

  const [exitInfo, localExit, proxyLat, localLat, quic] = await Promise.all([
    collectExit(node),
    collectLocalExit(),
    measureLatency(GLOBAL_LATENCY_URLS, node),
    measureLatency(MAINLAND_LATENCY_URLS, 'DIRECT'),
    detectQuic(node),
  ])

  const mediaNode = nodeForGroup(OPTS.media || pickGroup('media', state), state)
  const aiNode = nodeForGroup(OPTS.ai || pickGroup('ai', state), state)

  const [media, ai] = await Promise.all([
    runServices(MEDIA_SERVICES, mediaNode),
    runServices(AI_SERVICES, aiNode),
  ])

  const carrier = localExit.carrier || ''
  const netLabel = 'Loon · ' + state.modeLabel + (carrier ? ' · ' + carrier : '')

  const snapshot = {
    v: 1,
    ts: Date.now(),
    src: 'loon',
    masked: OPTS.mask,
    exit: {
      ip: displayIP(exitInfo.ip),
      cc: exitInfo.cc,
      country: exitInfo.country,
      region: exitInfo.region,
      city: exitInfo.city,
      isp: exitInfo.isp,
      asn: exitInfo.asn,
      org: exitInfo.org,
      proxy: exitInfo.flags.proxy,
      hosting: exitInfo.flags.hosting || exitInfo.flags.datacenter,
      mobile: exitInfo.flags.mobile,
      kind: exitInfo.kind,
      purity: exitInfo.purity,
      risk: exitInfo.risk,
    },
    local: {
      net: netLabel,
      ip: displayIP(localExit.ip),
      gw: '',
      dns: '',
      area: localExit.area,
      carrier: carrier,
      nat: detectNAT(localExit.ip, exitInfo.ip).label,
      vpn: true,
      v6: false,
    },
    lat: { proxy: proxyLat.ms, local: localLat.ms },
    quic: { ok: quic.ok, reachable: quic.reachable },
    media: media,
    ai: ai,
    loon: {
      mode: state.modeLabel,
      group: state.group,
      node: OPTS.node || state.node,
      protocol: protocolFromName(OPTS.node || state.node),
      mediaNode: mediaNode || '',
      aiNode: aiNode || '',
    },
    cost: Date.now() - startedAt,
  }

  const json = JSON.stringify(snapshot)
  $persistentStore.write(json, KEY_SNAPSHOT)

  if (OPTS.sync) pushSync(OPTS.sync, json)
  if (OPTS.notify) notify(snapshot)

  log('done in ' + (Date.now() - startedAt) + 'ms')
  return snapshot
}

/* ------------------------------------------------------------------ */
/* 出口信息                                                            */
/* ------------------------------------------------------------------ */

async function collectExit(node) {
  const [ipApi, ipWho, ipApiIs, ipInfo] = await Promise.all([
    getJSON('http://ip-api.com/json/?lang=zh-CN&fields=status,message,query,country,countryCode,regionName,city,isp,org,as,asname,proxy,hosting,mobile&_=' + Date.now(), TIMEOUT, node),
    getJSON('https://ipwho.is/?lang=zh-CN&_=' + Date.now(), TIMEOUT, node),
    getJSON('https://api.ipapi.is/?_=' + Date.now(), TIMEOUT, node),
    getJSON('https://ipinfo.io/json?_=' + Date.now(), TIMEOUT, node),
  ])

  const flags = { proxy: false, vpn: false, tor: false, abuser: false, hosting: false, datacenter: false, mobile: false, residential: false }

  let ip = ''
  let cc = ''
  let country = ''
  let region = ''
  let city = ''
  let isp = ''
  let asn = ''
  let org = ''

  if (ipApi) {
    ip = ip || clean(ipApi.query)
    country = country || clean(ipApi.country)
    cc = cc || countryCode(ipApi.countryCode)
    region = region || clean(ipApi.regionName)
    city = city || clean(ipApi.city)
    isp = isp || clean(ipApi.isp)
    org = org || clean(ipApi.org)
    asn = asn || clean(ipApi.as)
    flags.proxy = flags.proxy || ipApi.proxy === true
    flags.hosting = flags.hosting || ipApi.hosting === true
    flags.mobile = flags.mobile || ipApi.mobile === true
  }

  if (ipWho && ipWho.success !== false) {
    const conn = ipWho.connection || {}
    ip = ip || clean(ipWho.ip)
    country = country || clean(ipWho.country)
    cc = cc || countryCode(ipWho.country_code)
    region = region || clean(ipWho.region)
    city = city || clean(ipWho.city)
    isp = isp || clean(conn.isp) || clean(conn.org)
    org = org || clean(conn.org)
    asn = asn || (conn.asn ? 'AS' + conn.asn : '')
  }

  if (ipApiIs) {
    const asnInfo = ipApiIs.asn || {}
    const loc = ipApiIs.location || {}
    const company = ipApiIs.company || {}
    ip = ip || clean(ipApiIs.ip)
    country = country || clean(loc.country)
    cc = cc || countryCode(loc.country_code)
    region = region || clean(loc.state)
    city = city || clean(loc.city)
    org = org || clean(asnInfo.org) || clean(company.name)
    asn = asn || (asnInfo.asn ? String(asnInfo.asn) : '')
    flags.mobile = flags.mobile || ipApiIs.is_mobile === true
    flags.datacenter = flags.datacenter || ipApiIs.is_datacenter === true
    flags.proxy = flags.proxy || ipApiIs.is_proxy === true
    flags.vpn = flags.vpn || ipApiIs.is_vpn === true
    flags.tor = flags.tor || ipApiIs.is_tor === true
    flags.abuser = flags.abuser || ipApiIs.is_abuser === true
  }

  if (ipInfo) {
    ip = ip || clean(ipInfo.ip)
    cc = cc || countryCode(ipInfo.country)
    city = city || clean(ipInfo.city)
    region = region || clean(ipInfo.region)
    const orgText = clean(ipInfo.org)
    if (orgText && !asn) {
      const matched = orgText.match(/^(AS\d+)\s+(.*)$/)
      if (matched) {
        asn = matched[1]
        org = org || matched[2]
      } else {
        org = org || orgText
      }
    }
  }

  if (!ip) {
    return { ip: '', cc: '', country: '', region: '', city: '', isp: '', asn: '', org: '', flags: flags, kind: '未知网络', purity: 0, risk: '未知' }
  }

  flags.residential = !flags.datacenter && !flags.hosting && !flags.proxy && !flags.vpn && !flags.tor && !flags.mobile

  const kind = classifyExitKind(flags)
  const purity = purityScore(flags, kind)
  const risk = riskLevel(flags, purity)

  return {
    ip: ip,
    cc: cc,
    country: country,
    region: region,
    city: city,
    isp: isp || org,
    asn: asn.startsWith('AS') || !asn ? asn : 'AS' + asn,
    org: org,
    flags: flags,
    kind: kind,
    purity: purity,
    risk: risk,
  }
}


async function collectLocalExit() {
  const [ipip, plainIp] = await Promise.all([
    getText('https://myip.ipip.net', TIMEOUT, 'DIRECT'),
    getText('https://ip.3322.net', TIMEOUT, 'DIRECT'),
  ])

  let ip = ''
  let area = ''
  let carrier = ''

  const ipMatch = clean(ipip).match(/IP[：:\s]*([0-9]{1,3}(\.[0-9]{1,3}){3})/i)
  if (ipMatch) ip = ipMatch[1]

  const fromMatch = clean(ipip).match(/来自于[：:\s]*(.+)$/m)
  if (fromMatch) {
    const parts = fromMatch[1].trim().split(/\s+/).filter(Boolean)
    if (parts.length > 0) {
      carrier = parts[parts.length - 1]
      area = parts.slice(0, parts.length - 1).join(' ')
    }
  }

  if (!ip) {
    const plainMatch = clean(plainIp).match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/)
    if (plainMatch) ip = plainMatch[1]
  }

  if (ip && (!area || !carrier)) {
    const detail = await getJSON('http://ip-api.com/json/' + ip + '?lang=zh-CN&fields=status,country,regionName,city,isp,org,as&_=' + Date.now(), TIMEOUT, 'DIRECT')
    if (detail) {
      area = area || [clean(detail.country), clean(detail.regionName), clean(detail.city)].filter(Boolean).join(' ')
      carrier = carrier || clean(detail.isp) || clean(detail.org)
    }
  }

  return { ip: ip, area: area || '中国大陆', carrier: shortCarrier(carrier) }
}

async function detectQuic(node) {
  const results = await Promise.all(QUIC_TRACE_URLS.map(function (url) {
    return getText(url + '?_=' + Date.now(), TIMEOUT, node)
  }))

  let hasH3 = false
  let reachable = false

  for (let i = 0; i < results.length; i += 1) {
    const text = results[i]
    if (!text) continue
    reachable = true
    const matched = text.match(/^http=(.+)$/m)
    const protocol = matched ? matched[1].trim().toLowerCase() : ''
    if (protocol === 'h3' || protocol.indexOf('h3') >= 0 || protocol.indexOf('http/3') >= 0) {
      hasH3 = true
      break
    }
  }

  return { ok: hasH3, reachable: reachable }
}

async function measureLatency(urls, node) {
  const results = await Promise.all(urls.map(function (url) {
    const started = Date.now()
    return getStatus(url, TIMEOUT, node).then(function (status) {
      return { ok: status >= 200 && status < 500, ms: Math.max(1, Date.now() - started) }
    })
  }))

  const passed = results.filter(function (item) { return item.ok }).sort(function (a, b) { return a.ms - b.ms })
  return { ok: passed.length > 0, ms: passed.length ? passed[0].ms : 0 }
}

async function runServices(services, node) {
  return mapLimit(services, CONCURRENCY, async function (service) {
    const status = await getStatus(
      service.url + (service.url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(),
      TIMEOUT,
      node
    )
    return { id: service.id, name: service.name, ok: status >= 200 && status < 500, policy: node || '' }
  })
}

/* ------------------------------------------------------------------ */
/* Loon 环境：策略组 / 当前节点 / 协议                                  */
/* ------------------------------------------------------------------ */

function readConfig() {
  try {
    const c = decode($config && $config.getConfig ? $config.getConfig() : null)
    return c && typeof c === 'object' ? c : {}
  } catch (e) {
    return {}
  }
}

function nameOf(x) {
  if (typeof x === 'string') return x
  return x && typeof x.name === 'string' ? x.name : ''
}

function groupNames(conf) {
  if (Array.isArray(conf.all_policy_groups)) return conf.all_policy_groups.map(nameOf).filter(Boolean)
  return Object.keys(conf.policy_select || {})
}

function selectedOf(name, conf) {
  const ps = conf.policy_select || {}
  let v = ps[name]
  if (v && typeof v === 'object') v = v.now || v.name
  v = nameOf(decode(v))
  if (v) return v

  try {
    // 新版：getSelectedPolicy；旧版别名：getPolicy
    const getter = $config && ($config.getSelectedPolicy || $config.getPolicy)
    const raw = decode(getter ? getter.call($config, name) : '')
    if (typeof raw === 'string' && raw) return raw
    if (raw && typeof raw === 'object') return nameOf(raw.now || raw.name)
  } catch (e) {}

  return ''
}

function leafOf(name, conf, groups) {
  let cur = name
  const set = groups || groupNames(conf)
  for (let i = 0; i < 8; i += 1) {
    if (set.indexOf(cur) < 0) break
    const next = selectedOf(cur, conf)
    if (!next || next === cur) break
    cur = next
  }
  return cur
}

function pickMainGroup(conf, groups) {
  const mode = Number(conf.running_model)
  if (mode === 0) return ''
  const preferred = ['节点', '代理', '机场', '手动', '主策略', 'Proxy', 'PROXY', '选择']
  for (let i = 0; i < preferred.length; i += 1) {
    for (let j = 0; j < groups.length; j += 1) {
      if (groups[j].indexOf(preferred[i]) >= 0) return groups[j]
    }
  }
  return groups.length ? groups[0] : ''
}

function pickGroup(kind, state) {
  const names = state.groups || []
  if (!names.length) return ''
  const candidates = kind === 'media' ? MEDIA_GROUP_CANDIDATES : AI_GROUP_CANDIDATES
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = 0; j < names.length; j += 1) {
      if (names[j].indexOf(candidates[i]) >= 0) return names[j]
    }
  }
  return ''
}

function nodeForGroup(group, state) {
  if (OPTS.node) return OPTS.node
  if (!group) return state.node
  // Loon 的 node 参数支持直接填策略组名，交给 Loon 自己选路
  return group
}

function readLoonState() {
  const conf = readConfig()
  const groups = groupNames(conf)
  const mode = Number(conf.running_model)
  const modeLabel = mode === 0 ? '全局直连' : mode === 2 ? '全局代理' : '规则分流'
  const group = pickMainGroup(conf, groups)
  const node = OPTS.node || (group ? leafOf(group, conf, groups) : '')
  return { conf: conf, groups: groups, mode: mode, modeLabel: modeLabel, group: group, node: node }
}

function protocolFromName(name) {
  const text = clean(name).toLowerCase()
  if (!text) return ''
  const table = [
    ['vless', 'VLESS'], ['vmess', 'VMess'], ['trojan', 'Trojan'],
    ['hysteria2', 'HY2'], ['hy2', 'HY2'], ['tuic', 'TUIC'],
    ['ss2022', 'SS'], ['shadowsocks', 'SS'], ['anytls', 'AnyTLS'],
    ['snell', 'Snell'], ['wireguard', 'WG'], ['ssh', 'SSH'],
  ]
  for (let i = 0; i < table.length; i += 1) {
    if (text.indexOf(table[i][0]) >= 0) return table[i][1]
  }
  return ''
}


/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function get(url, timeout, node) {
  return new Promise(function (resolve) {
    const options = {
      url: url,
      timeout: timeout || TIMEOUT,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,text/html,*/*',
        'Cache-Control': 'no-cache',
      },
    }
    if (node) options.node = node

    const started = Date.now()
    $httpClient.get(options, function (error, response, data) {
      resolve({
        error: error || null,
        status: response ? response.status : 0,
        text: typeof data === 'string' ? data : '',
        ms: Math.max(1, Date.now() - started),
      })
    })
  })
}

async function getText(url, timeout, node) {
  const result = await get(url, timeout, node)
  if (result.error || result.status < 200 || result.status >= 500) return ''
  return result.text || ''
}

async function getStatus(url, timeout, node) {
  const result = await get(url, timeout, node)
  if (result.error) return 0
  return result.status || 0
}

async function getJSON(url, timeout, node) {
  const text = await getText(url, timeout, node)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

function pushSync(url, body) {
  try {
    $httpClient.post({
      url: url,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Loon-Radar/1.0' },
      body: body,
    }, function (error) {
      log(error ? 'sync failed: ' + error : 'sync ok')
    })
  } catch (e) {
    log('sync error: ' + e)
  }
}

/* ------------------------------------------------------------------ */
/* 通知 & 日志                                                         */
/* ------------------------------------------------------------------ */

function notify(snapshot) {
  const exit = snapshot.exit
  const mediaOk = snapshot.media.filter(function (item) { return item.ok }).length
  const aiOk = snapshot.ai.filter(function (item) { return item.ok }).length

  const locationText = [flagEmoji(exit.cc), exit.cc, exit.city].filter(Boolean).join(' ')
  const subtitle = [locationText, exit.ip].filter(Boolean).join(' · ')
  const body = [
    '代理 ' + (snapshot.lat.proxy || '—') + 'ms / 直连 ' + (snapshot.lat.local || '—') + 'ms / QUIC ' + (snapshot.quic.ok ? '✓' : '✗'),
    '纯净 ' + exit.purity + ' · ' + exit.risk + ' · ' + (exit.kind || '未知'),
    '媒体 ' + mediaOk + '/' + snapshot.media.length + ' · AI ' + aiOk + '/' + snapshot.ai.length,
  ].join('\n')

  $notification.post('网络诊断雷达', subtitle, body)
}

function log(message) {
  if (OPTS.debug) console.log('[radar] ' + message)
}

/* ------------------------------------------------------------------ */
/* 本地数据接口                                                        */
/* ------------------------------------------------------------------ */

function respond(status, obj) {
  $done({
    response: {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify(obj),
    },
  })
}

function readSnapshot() {
  try {
    const raw = $persistentStore.read(KEY_SNAPSHOT)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

function handleOpts() {
  let patch = {}
  try {
    patch = JSON.parse(($request && $request.body) || '{}')
  } catch (e) {
    return { v: 1, ok: false, error: 'body 不是合法 JSON' }
  }

  const next = {}
  Object.keys(DEFAULT_OPTS).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(OPTS, key)) next[key] = OPTS[key]
  })
  Object.keys(patch).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_OPTS, key)) return
    if (patch[key] === '' || patch[key] === null) next[key] = DEFAULT_OPTS[key]
    else next[key] = patch[key]
  })

  $persistentStore.write(JSON.stringify(next), KEY_OPTS)
  return { v: 1, ok: true, opts: next }
}

async function handleRequest() {
  const url = $request.url
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0].replace(/\/+$/, '')

  if (path === '/radar/run') return respond(200, await diagnose())

  if (path === '/radar/opts') return respond(200, handleOpts())

  if (path === '/radar/data') {
    const cached = readSnapshot()
    if (clean(QUERY.run) === '1' || !cached) return respond(200, await diagnose())
    const age = Date.now() - (Number(cached.ts) || 0)
    return respond(200, Object.assign({}, cached, { age: age, stale: age > 30 * 60 * 1000 }))
  }

  respond(404, { v: 1, error: 'not found' })
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

if (isRequest) {
  handleRequest().catch(function (e) {
    console.log('radar request error: ' + (e && e.message ? e.message : e))
    respond(500, { v: 1, error: String((e && e.message) || e) })
  })
} else {
  diagnose().then(function () {
    $done()
  }).catch(function (e) {
    console.log('radar fatal: ' + (e && e.message ? e.message : e))
    if (OPTS.notify) $notification.post('网络诊断雷达', '诊断失败', String((e && e.message) || e).slice(0, 180))
    $done()
  })
}


/* ------------------------------------------------------------------ */
/* 参数与工具函数                                                      */
/* ------------------------------------------------------------------ */

function readStoredOpts() {
  try {
    const raw = $persistentStore.read(KEY_OPTS)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    return {}
  }
}

function buildOpts() {
  const merged = Object.assign({}, DEFAULT_OPTS, readStoredOpts())
  applyOptions(merged, readArgument())
  applyOptions(merged, QUERY)
  return merged
}

/** 新版插件会把参数以对象形式传进 $argument；旧式 argument="a=1&b=2" 也兼容 */
function readArgument() {
  let raw = ''
  try {
    raw = typeof $argument === 'undefined' ? '' : $argument
  } catch (e) {
    raw = ''
  }
  if (raw && typeof raw === 'object') return raw
  return parseArgument(typeof raw === 'string' ? raw : '')
}

function truthy(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const text = clean(value).toLowerCase()
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false
  return fallback
}

function applyOptions(target, src) {
  if (!src) return
  if (src.node) target.node = clean(src.node)
  if (src.lmt) target.media = clean(src.lmt)
  if (src.media !== undefined && src.media !== null && src.media !== '') target.media = clean(src.media)
  if (src.ai !== undefined && src.ai !== null && src.ai !== '') target.ai = clean(src.ai)
  if (src.sync) target.sync = clean(src.sync)
  if (src.mask !== undefined) target.mask = truthy(src.mask, target.mask)
  if (src.ys !== undefined) target.mask = truthy(src.ys, target.mask)
  if (src.notify !== undefined) target.notify = truthy(src.notify, target.notify)
  if (src.debug !== undefined) target.debug = truthy(src.debug, target.debug)
}

function parseArgument(raw) {
  const out = {}
  clean(raw).split('&').forEach(function (pair) {
    if (!pair) return
    const index = pair.indexOf('=')
    if (index < 0) {
      out[pair.trim()] = '1'
      return
    }
    const key = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (key) out[key] = value
  })
  return out
}

function parseQuery(url) {
  const out = {}
  const query = clean(url).split('?')[1]
  if (!query) return out
  query.split('#')[0].split('&').forEach(function (pair) {
    if (!pair) return
    const index = pair.indexOf('=')
    if (index < 0) {
      out[decodeURIComponent(pair)] = '1'
      return
    }
    try {
      out[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(pair.slice(index + 1))
    } catch (e) {}
  })
  return out
}

function decode(v) {
  if (typeof v !== 'string') return v === undefined || v === null ? '' : v
  const s = v.trim()
  if (!s || s === 'null' || s === 'undefined') return ''
  if (s[0] === '"' || s[0] === '[' || s[0] === '{') {
    try { return decode(JSON.parse(s)) } catch (e) { return s }
  }
  return s
}

function clean(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function countryCode(value) {
  const text = clean(value).toUpperCase()
  return /^[A-Z]{2}$/.test(text) ? text : ''
}

function flagEmoji(cc) {
  const code = countryCode(cc)
  if (!code) return ''
  return String.fromCodePoint.apply(null, code.split('').map(function (char) {
    return 127397 + char.charCodeAt(0)
  }))
}

function displayIP(ip) {
  const value = clean(ip)
  if (!OPTS.mask || !value) return value
  const parts = value.split('.')
  if (parts.length === 4) return parts[0] + '.' + parts[1] + '.*.*'
  const groups = value.split(':')
  if (groups.length > 2) return groups.slice(0, 2).join(':') + ':***'
  return value
}

function shortCarrier(value) {
  const text = clean(value)
  if (!text) return ''
  if (/移动|cmcc|china mobile/i.test(text)) return '中国移动'
  if (/联通|unicom/i.test(text)) return '中国联通'
  if (/电信|telecom|chinanet/i.test(text)) return '中国电信'
  if (/广电|broadnet/i.test(text)) return '中国广电'
  if (/教育|edu/i.test(text)) return '教育网'
  if (/阿里|alibaba|aliyun/i.test(text)) return '阿里云'
  if (/腾讯|tencent/i.test(text)) return '腾讯云'
  return text.length > 12 ? text.slice(0, 12) : text
}

function classifyExitKind(flags) {
  if (flags.mobile) return '移动网络'
  if (flags.residential) return '住宅 IP'
  if (flags.datacenter || flags.hosting) return '商业机房'
  if (flags.proxy || flags.vpn) return '住宅 IP'
  return '未知网络'
}

function purityScore(flags, kind) {
  let score
  if (kind === '住宅 IP' || kind === '移动网络') score = 92
  else if (kind === '商业机房') score = 78
  else score = 72

  const proxyVpnCount = (flags.proxy ? 1 : 0) + (flags.vpn ? 1 : 0)

  if (flags.tor) score -= 55
  if (flags.abuser) score -= 35
  if (proxyVpnCount >= 2) score -= 30
  else if (proxyVpnCount === 1) score -= 16
  if (kind === '商业机房' || flags.datacenter || flags.hosting) score -= 8

  if ((kind === '住宅 IP' || kind === '移动网络') && !flags.proxy && !flags.vpn && !flags.tor && !flags.abuser) {
    score += 3
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

function riskLevel(flags, score) {
  const proxyVpnCount = (flags.proxy ? 1 : 0) + (flags.vpn ? 1 : 0)
  if (flags.tor || flags.abuser || score < 45 || (proxyVpnCount >= 2 && score < 60)) return '高风险'
  if (score < 75 || flags.datacenter || flags.hosting || proxyVpnCount > 0) return '中风险'
  return '低风险'
}

function detectNAT(localIP, exitIP) {
  if (isCGNATIPv4(localIP)) return { label: 'CGNAT', tone: 'amber' }
  if (isPrivateIPv4(localIP) && isPublicIPv4(exitIP)) return { label: 'Open', tone: 'green' }
  if (isPublicIPv4(localIP)) return { label: 'Open', tone: 'green' }
  if (isPrivateIPv4(localIP)) return { label: 'NAT', tone: 'amber' }
  return { label: '未知', tone: 'red' }
}

function parseIPv4(ip) {
  const parts = clean(ip).split('.')
  if (parts.length !== 4) return null
  const values = parts.map(Number)
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isInteger(values[i]) || values[i] < 0 || values[i] > 255) return null
  }
  return values
}

function isPrivateIPv4(ip) {
  const parts = parseIPv4(ip)
  if (!parts) return false
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
}

function isCGNATIPv4(ip) {
  const parts = parseIPv4(ip)
  return Boolean(parts && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
}

function isPublicIPv4(ip) {
  const parts = parseIPv4(ip)
  if (!parts) return false
  return !isPrivateIPv4(ip) && !isCGNATIPv4(ip) &&
    parts[0] !== 0 && parts[0] !== 127 && parts[0] < 224 &&
    !(parts[0] === 169 && parts[1] === 254)
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0

  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }

  const runners = []
  const size = Math.min(limit || 1, items.length || 1)
  for (let i = 0; i < size; i += 1) runners.push(run())

  await Promise.all(runners)
  return results
}
