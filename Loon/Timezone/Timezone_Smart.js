/**
 * @name 智能动态时区伪装 (代理流量专属防漏版)
 * @author WilsonBryanz
 * @description 仅对代理生效。增强 Header 大小写精确覆盖，升级正则注入适配 Claude/Grok 现代前端框架。
 */

let proxyName = $agent ? $agent.name.toUpperCase() : "";

if (!proxyName || proxyName.includes("DIRECT") || proxyName === "直连" || proxyName.includes("REJECT")) {
    $done({});
}

let tzName = "Asia/Shanghai";
let gmtOffset = "+0800";
let timeOffsetMs = 0; 
let tzOffsetMin = -480; 

// 核心时区匹配引擎
if (proxyName.includes("US") || proxyName.includes("美")) {
    tzName = "America/New_York"; gmtOffset = "-0500"; timeOffsetMs = -46800000; tzOffsetMin = 300;
} else if (proxyName.includes("JP") || proxyName.includes("日") || proxyName.includes("东京")) {
    tzName = "Asia/Tokyo"; gmtOffset = "+0900"; timeOffsetMs = 3600000; tzOffsetMin = -540;
} else if (proxyName.includes("UK") || proxyName.includes("英") || proxyName.includes("伦敦")) {
    tzName = "Europe/London"; gmtOffset = "+0000"; timeOffsetMs = -28800000; tzOffsetMin = 0;
} else if (proxyName.includes("DE") || proxyName.includes("德") || proxyName.includes("法") || proxyName.includes("欧") || proxyName.includes("EU")) {
    tzName = "Europe/Berlin"; gmtOffset = "+0100"; timeOffsetMs = -25200000; tzOffsetMin = -60;
} else if (proxyName.includes("AE") || proxyName.includes("迪拜") || proxyName.includes("阿联酋")) {
    tzName = "Asia/Dubai"; gmtOffset = "+0400"; timeOffsetMs = -14400000; tzOffsetMin = -240;
} else if (proxyName.includes("KR") || proxyName.includes("韩") || proxyName.includes("首尔")) {
    tzName = "Asia/Seoul"; gmtOffset = "+0900"; timeOffsetMs = 3600000; tzOffsetMin = -540;
} else if (proxyName.includes("TW") || proxyName.includes("台")) {
    tzName = "Asia/Taipei"; gmtOffset = "+0800"; timeOffsetMs = 0; tzOffsetMin = -480;
} else if (proxyName.includes("SG") || proxyName.includes("新") || proxyName.includes("狮城")) {
    tzName = "Asia/Singapore"; gmtOffset = "+0800"; timeOffsetMs = 0; tzOffsetMin = -480;
}

// ----------------------------------------------------
// 【执行引擎 A】：App API 请求头拦截
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

    if (url.includes("timezone=")) url = url.replace(/(timezone=)[^&]+/g, '$1' + encodeURIComponent(tzName));
    $done({url, headers});
}

// ----------------------------------------------------
// 【执行引擎 B】：Web 网页 HTML 暴力注入
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
            const fakeTzName = '${tzName}';
            const fakeGmtOffset = '${gmtOffset}';
            const fakeTimeOffsetMs = ${timeOffsetMs};
            const fakeTzOffsetMin = ${tzOffsetMin};
            const tzRegex = /GMT[+-]\\d{4}\\s*\\(.*?\\)/;
            const fakeTzStr = 'GMT' + fakeGmtOffset + ' (' + fakeTzName + ')';

            // 1. 重写 Date 对象
            class FakeDate extends __oDate {
                constructor(...args) {
                    if (args.length === 0) super(super.now() + fakeTimeOffsetMs);
                    else super(...args);
                }
                static now() { return __oDate.now() + fakeTimeOffsetMs; }
            }
            
            // 2. 深度抹除字符串特征
            FakeDate.prototype.getTimezoneOffset = function() { return fakeTzOffsetMin; };
            FakeDate.prototype.toString = function() {
                return __oDate.prototype.toString.call(this).replace(tzRegex, fakeTzStr);
            };
            FakeDate.prototype.toTimeString = function() {
                return __oDate.prototype.toTimeString.call(this).replace(tzRegex, fakeTzStr);
            };
            globalThis.Date = FakeDate;

            // 3. 重写 Intl 国际化 API
            const __oIntl = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function(...args) {
                let opts = args[1] || {};
                if (!opts.timeZone) opts.timeZone = fakeTzName;
                return new __oIntl(args[0], opts);
            };

            // 4. 【SRE 终极防御】：Iframe 沙盒逃逸追杀
            if (typeof document !== 'undefined') {
                const __createElement = document.createElement.bind(document);
                document.createElement = function(tagName) {
                    const el = __createElement(tagName);
                    if (tagName.toLowerCase() === 'iframe') {
                        el.addEventListener('load', function() {
                            try {
                                this.contentWindow.Date = globalThis.Date;
                                this.contentWindow.Intl = globalThis.Intl;
                            } catch(e) {}
                        });
                    }
                    return el;
                };
            }
        })();
    </script>`;

    // 暴力注入引擎：寻找 head，找不到找 html，再找不到直接塞最前面
    if (body && typeof body === "string") {
        if (/<head[^>]*>/i.test(body)) {
            body = body.replace(/(<head[^>]*>)/i, `$1${injectJS}`);
        } else if (/<html[^>]*>/i.test(body)) {
            body = body.replace(/(<html[^>]*>)/i, `$1${injectJS}`);
        } else {
            body = injectJS + body;
        }
        $done({body});
    } else {
        $done({});
    }
}
