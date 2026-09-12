// 获取当前 Loon 路由链路上实际命中的代理节点名称
let proxyName = $agent ? $agent.name : "";

let targetRegion = "SG"; // 默认回退为新加坡
let mcc = "52504";
let tz = "Asia/Singapore";

// 智能匹配策略组选中的节点名称关键字
let upperProxy = proxyName.toUpperCase();
if (upperProxy.includes("美") || upperProxy.includes("US") || upperProxy.includes("UNITED STATES")) {
    targetRegion = "US";
    mcc = "310410";
    tz = "America/New_York";
} else if (upperProxy.includes("日") || upperProxy.includes("JP") || upperProxy.includes("东京") || upperProxy.includes("大阪")) {
    targetRegion = "JP";
    mcc = "44010";
    tz = "Asia/Tokyo";
} else if (upperProxy.includes("台") || upperProxy.includes("TW") || upperProxy.includes("台湾")) {
    targetRegion = "TW";
    mcc = "46692";
    tz = "Asia/Taipei";
} else if (upperProxy.includes("韩") || upperProxy.includes("KR") || upperProxy.includes("韩国") || upperProxy.includes("首尔")) {
    targetRegion = "KR";
    mcc = "45005";
    tz = "Asia/Seoul";
} else if (upperProxy.includes("欧") || upperProxy.includes("EU") || upperProxy.includes("德") || upperProxy.includes("英") || upperProxy.includes("法")) {
    targetRegion = "GB"; // 欧洲或英国统配
    mcc = "23430";
    tz = "Europe/London";
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
