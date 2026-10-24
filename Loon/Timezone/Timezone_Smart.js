/**
 * @name 全自动感知环境伪装 (Loon 终极自适应版)
 * @author WilsonBryanz
 * @description 引入惰性嗅探 (Cache-Aside) 架构。无论如何切换节点，自动后台检测落地 IP，精准计算毫秒级时差与语言指纹。
 */

// 1. 从 Loon 本地缓存读取环境数据（默认兜底为美国）
let tzName = $persistentStore.read("SRE_TZ") || "America/New_York";
let cc = $persistentStore.read("SRE_CC") || "US";
let gmtOffset = $persistentStore.read("SRE_GMT") || "-0500";
let timeOffsetMs = parseInt($persistentStore.read("SRE_OFFSET_MS") || "-46800000");
let tzOffsetMin = parseInt($persistentStore.read("SRE_OFFSET_MIN") || "300");

// 2. 多国语言指纹自适应矩阵
let langMap = {
    "US": { l: "en-US", ls: "['en-US', 'en']", al: "en-US,en;q=0.9" },
    "JP": { l: "ja-JP", ls: "['ja-JP', 'ja', 'en-US', 'en']", al: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" },
    "GB": { l: "en-GB", ls: "['en-GB', 'en-US', 'en']", al: "en-GB,en-US;q=0.9,en;q=0.8" },
    "DE": { l: "de-DE", ls: "['de-DE', 'de', 'en-US', 'en']", al: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7" },
    "KR": { l: "ko-KR", ls: "['ko-KR', 'ko', 'en-US', 'en']", al: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7" },
    "SG": { l: "en-SG", ls: "['en-SG', 'en-US', 'en']", al: "en-SG,en-US;q=0.9,en;q=0.8" },
    "TW": { l: "zh-TW", ls: "['zh-TW', 'zh-HK', 'zh', 'en-US', 'en']", al: "zh-TW,zh-HK;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6" },
    "HK": { l: "zh-HK", ls: "['zh-HK', 'zh-TW', 'zh', 'en-US', 'en']", al: "zh-HK,zh-TW;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6" },
    "AE": { l: "ar-AE", ls: "['ar-AE', 'ar', 'en-US', 'en']", al: "ar-AE,ar;q=0.9,en-US;q=0.8,en;q=0.7" }
};
let langCfg = langMap[cc] || langMap["US"];

// ----------------------------------------------------
// 【异步静默探测引擎】：每 60 秒自动纠正一次 IP 归属地
// ----------------------------------------------------
let lastCheck = $persistentStore.read("SRE_LAST_CHECK");
let now = Date.now();
// 节流控制：60秒内只探测一次，防 API 封禁，绝对不影响网页加载速度
if (!lastCheck || (now - parseInt(lastCheck)) > 60000) {
    $persistentStore.write(now.toString(), "SRE_LAST_CHECK");
    
    // 通过当前代理节点查询真实出口 IP 信息
    $httpClient.get("http://ip-api.com/json/?fields=countryCode,timezone,offset", function(error, response, data){
        if(!error){
            try {
                let obj = JSON.parse(data);
                if(obj.timezone && obj.countryCode) {
                    $persistentStore.write(obj.timezone, "SRE_TZ");
                    $persistentStore.write(obj.countryCode, "SRE_CC");
                    
                    // 核心数学引擎：动态计算系统物理时区与代理时区的绝对偏移量
                    let targetOffsetMin = obj.offset / 60; 
                    let systemOffsetMin = -(new Date().getTimezoneOffset());
                    let diffMin = targetOffsetMin - systemOffsetMin;
                    let calculatedTimeOffsetMs = diffMin * 60 * 1000;
                    let calculatedTzOffsetMin = -targetOffsetMin; 

                    let sign = obj.offset >= 0 ? "+" : "-";
                    let absHour = Math.floor(Math.abs(obj.offset) / 3600).toString().padStart(2, '0');
                    let absMin = Math.floor((Math.abs(obj.offset) % 3600) / 60).toString().padStart(2, '0');
                    let gmtStr = sign + absHour + absMin;

                    $persistentStore.write(gmtStr, "SRE_GMT");
                    $persistentStore.write(calculatedTimeOffsetMs.toString(), "SRE_OFFSET_MS");
                    $persistentStore.write(calculatedTzOffsetMin.toString(), "SRE_OFFSET_MIN");
                }
            } catch(e) {}
        }
    });
}

// ----------------------------------------------------
// 【执行引擎 A】：App API 请求头拦截 (时区 + 语言动态注入)
// ----------------------------------------------------
if (typeof $response === "undefined") {
    let url = $request.url;
    let headers = $request.headers;
    let originalKeys = {};
    for (let key in headers) originalKeys[key.toLowerCase()] = key;

    let modifyHeader = (targetKey, value) => {
        if (originalKeys[targetKey]) headers[originalKeys[targetKey]] = value;
    };

    modifyHeader("x-timezone", tzName);
    modifyHeader("timezone", tzName);
    modifyHeader("tz", tzName);
    modifyHeader("x-gmt-offset", gmtOffset);
    modifyHeader("accept-language", langCfg.al);

    if (url.includes("timezone=")) url = url.replace(/(timezone=)[^&]+/g, '$1' + encodeURIComponent(tzName));
    $done({url, headers});
}

// ----------------------------------------------------
// 【执行引擎 B】：Web 网页 HTML 底层防指纹强力注入
// ----------------------------------------------------
if (typeof $response !== "undefined") {
    let headers = $response.headers;
    let contentType = headers["Content-Type"] || headers["content-type"] || "";
    if (!contentType.includes("text/html")) $done({});

    let body = $response.body;
    let injectJS = `
    <script>
        (function() {
            const __oDate = Date;
            const fakeTzName = '${tzName}'; const fakeGmtOffset = '${gmtOffset}';
            const fakeTimeOffsetMs = ${timeOffsetMs}; const fakeTzOffsetMin = ${tzOffsetMin};
            const tzRegex = /GMT[+-]\\d{4}\\s*\\(.*?\\)/;
            const fakeTzStr = 'GMT' + fakeGmtOffset + ' (' + fakeTzName + ')';

            class FakeDate extends __oDate {
                constructor(...args) {
                    if (args.length === 0) super(super.now() + fakeTimeOffsetMs);
                    else super(...args);
                }
                static now() { return __oDate.now() + fakeTimeOffsetMs; }
            }
            FakeDate.prototype.getTimezoneOffset = function() { return fakeTzOffsetMin; };
            FakeDate.prototype.toString = function() { return __oDate.prototype.toString.call(this).replace(tzRegex, fakeTzStr); };
            FakeDate.prototype.toTimeString = function() { return __oDate.prototype.toTimeString.call(this).replace(tzRegex, fakeTzStr); };
            globalThis.Date = FakeDate;

            const __oIntl = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function(...args) {
                let opts = args[1] || {};
                if (!opts.timeZone) opts.timeZone = fakeTzName;
                return new __oIntl(args[0], opts);
            };

            const navProto = Object.getPrototypeOf(navigator);
            Object.defineProperty(navProto, 'language', { get: () => '${langCfg.l}' });
            Object.defineProperty(navProto, 'languages', { get: () => ${langCfg.ls} });
            Object.defineProperty(navProto, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navProto, 'deviceMemory', { get: () => 8 });

            if (typeof document !== 'undefined') {
                const __createElement = document.createElement.bind(document);
                document.createElement = function(tagName) {
                    const el = __createElement(tagName);
                    if (tagName.toLowerCase() === 'iframe') {
                        el.addEventListener('load', function() {
                            try {
                                this.contentWindow.Date = globalThis.Date;
                                this.contentWindow.Intl = globalThis.Intl;
                                const ifNavProto = Object.getPrototypeOf(this.contentWindow.navigator);
                                Object.defineProperty(ifNavProto, 'language', { get: () => '${langCfg.l}' });
                                Object.defineProperty(ifNavProto, 'languages', { get: () => ${langCfg.ls} });
                            } catch(e) {}
                        });
                    }
                    return el;
                };
            }
        })();
    </script>`;

    if (body && typeof body === "string") {
        if (/<head[^>]*>/i.test(body)) body = body.replace(/(<head[^>]*>)/i, `$1${injectJS}`);
        else if (/<html[^>]*>/i.test(body)) body = body.replace(/(<html[^>]*>)/i, `$1${injectJS}`);
        else body = injectJS + body;
        $done({body});
    } else {
        $done({});
    }
}
