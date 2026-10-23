/**
 * @name 智能动态时区伪装 (代理流量专属防漏版)
 * @author WilsonBryanz
 * @description 仅对代理生效。增强 Header 大小写精确覆盖，升级正则注入适配 Claude/Grok 现代前端框架。
 */

let proxyName = $agent ? $agent.name.toUpperCase() : "";

// 【第一层保险】：直连或拒绝策略，瞬间放行
if (!proxyName || proxyName.includes("DIRECT") || proxyName === "直连" || proxyName.includes("REJECT")) {
    $done({});
}

// 默认回退：北京/新加坡时区 (UTC+8)
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
// 【执行引擎 A】：App API 请求头拦截 ($request)
// ----------------------------------------------------
if (typeof $response === "undefined") {
    let url = $request.url;
    let headers = $request.headers;
    
    // 【SRE核心修复】：精准映射原始 Header 大小写，防止双重键名导致真实时区泄漏
    let originalKeys = {};
    for (let key in headers) {
        originalKeys[key.toLowerCase()] = key;
    }

    let modifyHeader = (targetKey, value) => {
        if (originalKeys[targetKey]) {
            headers[originalKeys[targetKey]] = value;
        }
    };

    modifyHeader("x-timezone", tzName);
    modifyHeader("timezone", tzName);
    modifyHeader("tz", tzName);
    modifyHeader("x-gmt-offset", gmtOffset);

    // 篡改 URL 携带的时区参数
    if (url.includes("timezone=")) {
        url = url.replace(/(timezone=)[^&]+/g, '$1' + encodeURIComponent(tzName));
    }
    
    $done({url, headers});
}

// ----------------------------------------------------
// 【执行引擎 B】：Web 网页 HTML 注入 ($response)
// ----------------------------------------------------
if (typeof $response !== "undefined") {
    let headers = $response.headers;
    let contentType = headers["Content-Type"] || headers["content-type"] || "";
    
    // 非 HTML 网页直接放行，保护内存
    if (!contentType.includes("text/html")) {
        $done({});
    }

    let body = $response.body;
    let injectJS = `
    <script>
        const __oDate = Date;
        globalThis.Date = class extends __oDate {
            constructor(...args) {
                if (args.length === 0) super(super.now() + ${timeOffsetMs});
                else super(...args);
            }
            static now() { return __oDate.now() + ${timeOffsetMs}; }
        };
        Date.prototype.getTimezoneOffset = function() { return ${tzOffsetMin}; };
        const __oIntl = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function(...args) {
            let opts = args[1] || {};
            if (!opts.timeZone) opts.timeZone = '${tzName}';
            return new __oIntl(args[0], opts);
        };
    </script>`;

    // 【SRE核心修复】：正则匹配任意变异的 head 标签 (如 <head lang="en">)
    if (body && typeof body === "string" && /<head[^>]*>/i.test(body)) {
        body = body.replace(/(<head[^>]*>)/i, `$1${injectJS}`);
        $done({body});
    } else {
        $done({});
    }
}