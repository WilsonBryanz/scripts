/**
 * @name TikTok 智能换区 (节点联动版)
 * @description 根据 Proxy Group 选中的节点，自动切换 新、美、日、台、韩(KR)、英(UK) 等地区
 * @author WilsonBryanz
 * @version 1.1.1
 * @script-type http-request
 * @match ^https?:\/\/(.+\.)?(tiktokv|byteoversea|tik-tokapi)\.com\/.+
 * @requires-body false
 */

let proxyName = $agent ? $agent.name : "";

// 🇸🇬 新加坡区 (Singapore) - 默认兜底设置
let targetRegion = "SG";
let mcc = "52504";
let tz = "Asia/Singapore";

let upperProxy = proxyName.toUpperCase();

if (upperProxy.includes("美") || upperProxy.includes("US") || upperProxy.includes("UNITED STATES")) {
    // 🇺🇸 美国区 (United States)
    targetRegion = "US"; mcc = "310410"; tz = "America/New_York";
} else if (upperProxy.includes("日") || upperProxy.includes("JP") || upperProxy.includes("东京") || upperProxy.includes("大阪")) {
    // 🇯🇵 日本区 (Japan)
    targetRegion = "JP"; mcc = "44010"; tz = "Asia/Tokyo";
} else if (upperProxy.includes("台") || upperProxy.includes("TW") || upperProxy.includes("台湾") || upperProxy.includes("台北")) {
    // 🇹🇼 台湾区 (Taiwan)
    targetRegion = "TW"; mcc = "46692"; tz = "Asia/Taipei";
} else if (upperProxy.includes("韩") || upperProxy.includes("KR") || upperProxy.includes("韩国") || upperProxy.includes("首尔")) {
    // 🇰🇷 韩国区 (South Korea)
    targetRegion = "KR"; mcc = "45005"; tz = "Asia/Seoul";
} else if (upperProxy.includes("英") || upperProxy.includes("UK") || upperProxy.includes("GB") || upperProxy.includes("英国") || upperProxy.includes("伦敦")) {
    // 🇬🇧 英国区 (United Kingdom)
    targetRegion = "GB"; mcc = "23430"; tz = "Europe/London";
} else if (upperProxy.includes("欧") || upperProxy.includes("EU") || upperProxy.includes("德") || upperProxy.includes("法")) {
    // 🇪🇺 泛欧洲节点 (兜底映射至英国区内容)
    targetRegion = "GB"; mcc = "23430"; tz = "Europe/London";
}

let url = $request.url;
if (url.includes("?")) {
    url = url.replace(/(region=)[A-Z]{2}/g, '$1' + targetRegion)
             .replace(/(mcc_mnc=)[0-9]{5}/g, '$1' + mcc)
             .replace(/(carrier_region=)[A-Z]{2}/g, '$1' + targetRegion)
             .replace(/(timezone_name=)[^&]+/g, '$1' + encodeURIComponent(tz))
             .replace(/(sys_region=)[A-Z]{2}/g, '$1' + targetRegion);
    $done({ url });
} else {
    $done({});
}
