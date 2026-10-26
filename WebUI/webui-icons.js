(function (global) {
    'use strict';

    // 跨面板共用的内联 SVG 图标表。
    //
    // 为什么是独立文件而不是塞进 webui-core.js：BackpackUI 等少数页面没引 core.js
    // （它们内联了自己的一份 createWebUICore），图标表放 core.js 里那几页就取不到。
    // 本文件无副作用、不依赖 core，任何页面加一行 script 即可用。
    //
    // 为什么是内联 SVG 而不是 Res/ 下的图片：图标要跟随面板配色，且 .svg 不是 Unity
    // 原生格式，纯命令行工作流下新增图片还得手写 .meta。
    //
    // 用法：模板 v-html="WEBUI_ICONS.robot"，或 el.innerHTML = WEBUI_ICONS.robot。
    // 尺寸由使用方 CSS 控制（svg { width / height }），这里只给 viewBox。

    const SHELL = '#EFE8DA';    // 机身外壳，浅色，深底面板上最跳
    const EDGE = '#C9C0AE';     // 壳体描边 / 次要结构（天线杆、侧耳）
    const SCREEN = '#84DCF0';   // 屏幕冷青，与 RobotPanel 的荧光屏同色系
    const PUPIL = '#16323B';    // 屏幕上的暗色瞳孔

    global.WEBUI_ICONS = {
        // 整理机器人：天线 + 圆角方头 + 整块发光屏 + 两点眼 + 侧耳。
        // 走通用机器人符号而非写实还原模型，目的是 16~22px 行内一眼认出。
        // 屏幕外那圈辉光用一层半透明扩散矩形做，不用 filter / box-shadow：
        // 后者即便静态也要额外栅格化一遍，几何层是白拿的。
        robot:
            '<svg viewBox="0 0 24 24">'
            + '<rect x="11.1" y="1.6" width="1.8" height="3.4" rx=".9" fill="' + EDGE + '"/>'
            + '<circle cx="12" cy="1.8" r="1.6" fill="' + SCREEN + '"/>'
            + '<rect x="0.7" y="10" width="2.6" height="5.8" rx="1.3" fill="' + EDGE + '"/>'
            + '<rect x="20.7" y="10" width="2.6" height="5.8" rx="1.3" fill="' + EDGE + '"/>'
            + '<rect x="2.9" y="4.6" width="18.2" height="16.6" rx="4.6" fill="' + SHELL + '" stroke="' + EDGE + '" stroke-width=".7"/>'
            + '<rect x="5.1" y="7.4" width="13.8" height="10.4" rx="3.6" fill="' + SCREEN + '" opacity=".3"/>'
            + '<rect x="6.1" y="8.4" width="11.8" height="8.4" rx="3" fill="' + SCREEN + '"/>'
            + '<circle cx="9.5" cy="12.6" r="1.35" fill="' + PUPIL + '"/>'
            + '<circle cx="14.5" cy="12.6" r="1.35" fill="' + PUPIL + '"/>'
            + '</svg>',

        // 摊开的书：家具菜单「回看剧情」小钮。线描 + currentColor，悬停变色跟随按钮文字色。
        book:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
            + ' stroke-linejoin="round" stroke-linecap="round">'
            + '<path d="M12 6.5C10 5 7 4.6 3.5 5v13c3.5-.4 6.5 0 8.5 1.5 2-1.5 5-1.9 8.5-1.5V5C17 4.6 14 5 12 6.5z"/>'
            + '<path d="M12 6.5v13"/>'
            + '</svg>'
    };

})(window);
