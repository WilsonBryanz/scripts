/**
 * @name 智能动态时区伪装 (代理流量专属防漏版)
 * @author WilsonBryanz
 * @description 融合防指纹项目特性，支持动态时区、动态语言 (Navigator/Header)、硬件参数模糊化及 Iframe 逃逸追杀。
 */

let proxyName = $agent ? $agent.name.toUpperCase() : "";

if (!proxyName || proxyName.includes("DIRECT") || proxyName === "直连" || proxyName.includes("REJECT")) {
    $done({});
}

// 默认回退环境：新加坡 (英文环境更安全)
let tzName = "Asia/Singapore"; let gmtOffset = "+0800"; let timeOffsetMs = 0; let tzOffsetMin = -480; 
let navLang = "en-SG"; let navLangs = "['en-SG', 'en-US', 'en']"; let acceptLang = "en-SG,en-US;q=0.9,en;q=0.8";

// 核心环境匹配引擎 (时区 + 语言动态联动)
if (proxyName.includes("US") || proxyName.includes("美")) {
    tzName = "America/New_York"; gmtOffset = "-0500"; timeOffsetMs = -46800000; tzOffsetMin = 300;
    navLang = "en-US"; navLangs = "['en-US', 'en']"; acceptLang = "en-US,en;q=0.9";
} else if (proxyName.includes("JP") || proxyName.includes("日") || proxyName.includes("东京")) {
    tzName = "Asia/Tokyo"; gmtOffset = "+0900"; timeOffsetMs = 3600000; tzOffsetMin = -540;
    navLang = "ja-JP"; navLangs = "['ja-JP', 'ja', 'en-US', 'en']"; acceptLang = "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7";
} else if (proxyName.includes("UK") || proxyName.includes("英") || proxyName.includes("伦敦")) {
    tzName = "Europe/London"; gmtOffset = "+0000"; timeOffsetMs = -28800000; tzOffsetMin = 0;
    navLang = "en-GB"; navLangs = "['en-GB', 'en-US', 'en']"; acceptLang = "en-GB,en-US;q=0.9,en;q=0.8";
} else if (proxyName.includes("DE") || proxyName.includes("德") || proxyName.includes("法") || proxyName.includes("欧") || proxyName.includes("EU")) {
    tzName = "Europe/Berlin"; gmtOffset = "+0100"; timeOffsetMs = -25200000; tzOffsetMin = -60;
    navLang = "de-DE"; navLangs = "['de-DE', 'de', 'en-US', 'en']"; acceptLang = "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7";
} else if (proxyName.includes("AE") || proxyName.includes("迪拜") || proxyName.includes("阿联酋")) {
    tzName = "Asia/Dubai"; gmtOffset = "+0400"; timeOffsetMs = -14400000; tzOffsetMin = -240;
    navLang = "ar-AE"; navLangs = "['ar-AE', 'ar', 'en-US', 'en']"; acceptLang = "ar-AE,ar;q=0.9,en-US;q=0.8,en;q=0.7";
} else if (proxyName.includes("KR") || proxyName.includes("韩") || proxyName.includes("首尔")) {
    tzName = "Asia/Seoul"; gmtOffset = "+0900"; timeOffsetMs = 3600000; tzOffsetMin = -540;
    navLang = "ko-KR"; navLangs = "['ko-KR', 'ko', 'en-US', 'en']"; acceptLang = "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7";
} else if (proxyName.includes("TW") || proxyName.includes("台")) {
    tzName = "Asia/Taipei"; gmtOffset = "+0800"; timeOffsetMs = 0; tzOffsetMin = -480;
    navLang = "zh-TW"; navLangs = "['zh-TW', 'zh-HK', 'zh', 'en-US', 'en']"; acceptLang = "zh-TW,zh-HK;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6";
}

// ----------------------------------------------------
// 【引擎 A】：App API 请求头拦截 (语言 + 时区)
// ----------------------------------------------------
if (typeof $response === "undefined") {
    let url = $request.url;
    let headers = $request.headers;
    let originalKeys = {};
    for (let key in headers) originalKeys[key.toLowerCase()] = key;

    let modifyHeader = (targetKey, value) => {
        if (originalKeys[targetKey]) headers[originalKeys[targetKey]] = value;
    };

    // 时区篡改
    modifyHeader("x-timezone", tzName);
    modifyHeader("timezone", tzName);
    modifyHeader("tz", tzName);
    modifyHeader("x-gmt-offset", gmtOffset);
    // 语言篡改 (防指纹特征)
    modifyHeader("accept-language", acceptLang);

    if (url.includes("timezone=")) url = url.replace(/(timezone=)[^&]+/g, '$1' + encodeURIComponent(tzName));
    $done({url, headers});
}

// ----------------------------------------------------
// 【引擎 B】：Web 网页 HTML 指纹注入
// ----------------------------------------------------
if (typeof $response !== "undefined") {
    let headers = $response.headers;
    let contentType = headers["Content-Type"] || headers["content-type"] || "";
    if (!contentType.includes("text/html")) $done({});

    let body = $response.body;
    let injectJS = `
    <script>
        (function() {
            // --- 1. 时区指纹伪装 ---
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

            // --- 2. 环境语言指纹伪装 (借鉴 my-fingerprint) ---
            const navProto = Object.getPrototypeOf(navigator);
            Object.defineProperty(navProto, 'language', { get: () => '${navLang}' });
            Object.defineProperty(navProto, 'languages', { get: () => ${navLangs} });

            // --- 3. 硬件指纹模糊化 (借鉴 my-fingerprint) ---
            // 锁定核心数与内存，防止由于特异性硬件被追踪
            Object.defineProperty(navProto, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navProto, 'deviceMemory', { get: () => 8 });

            // --- 4. Iframe 沙盒逃逸追杀 ---
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
                                Object.defineProperty(ifNavProto, 'language', { get: () => '${navLang}' });
                                Object.defineProperty(ifNavProto, 'languages', { get: () => ${navLangs} });
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
