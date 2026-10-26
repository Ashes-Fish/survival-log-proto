/*
 * A/D 切页签键 · 每日首次提示（背包 / 制造台 / 烹饪三个高频容器面板）
 *
 * 背景：A/D 左右切容器页签的功能 2026-08-17 就实装了（ContainerTabHotKey 分发给 10 个面板），
 * 但它刻意不进 HotKeyAction 自定义体系（与 CameraManager 的镜头平移同键，收进去会造出查不出
 * 占用者的静默双绑），因此设置面板的键位列表里没有它这一行，各面板页签条上也没有任何键帽 ——
 * 玩家无从知道。本模块补的就是这条发现性。
 *
 * 为什么单独一个 js 而不是并进 webui-core.js：
 *   BackpackUI.html 没有引用共享的 webui-core.js，它把 createWebUICore 整个内联在自己页内
 *  （ToolTable / Cooking 才是走 <script src> 引共享层的）。写进 core 等于漏掉背包 —— 而背包恰恰
 *   是玩家反馈里点名的那个面板。拆成独立文件后代码只有一份，三个页面各加一行 <script src> 即可，
 *   同时不必去动被 60+ 个页面共用的 webui-core.js，影响面收窄到这三页。
 *
 * 通道：C# 侧 WebUILayer.RouteToPageOrQueue(pageId, MSG_TYPE_TAB_KEY_HINT, ...) → Root.html
 *       ROUTE_MESSAGE(typeId=8) 定向 postMessage 给发起面板这一个 iframe。C# 是在面板打开那一刻发的，
 *       此时 iframe 往往还没 ready —— 由 C# 侧的 per-page 队列兜住：未 ready 入队，PAGE_READY 后回放一次，
 *       面板移除时连队列清掉。收到的消息形状与广播完全一致：{ type, data }。
 *
 * 为什么不走 BROADCAST_MESSAGE(typeId=10)（首版 CL 15740 就是这么写的）：Root 会把广播存进 broadcastCache
 * 并给每个之后 ready 的 iframe 补发，而这个缓存从不失效——面板关闭 = 销毁 iframe、重开 = 新 iframe + 新
 * PAGE_READY，于是同一面板当天每次重开都被补发一次、重弹提示，玩家学会之后照样弹到退出进程
 *（2026-09-08 review 指出）。一次性事件不该进状态型缓存。
 *
 * payload 里仍带发起面板的目录名、页面只认自己那条（见 PAGE_DIR 比对）：定向投递后这层过滤已是双保险，
 * 留着是为了万一将来有人把通道改回广播时，至少不会在当天第二个面板重复弹。
 *
 * 布局上刻意不碰任何现有元素：提示用 position:fixed + getBoundingClientRect 定位，
 * 既不依赖页签条祖先有没有定位上下文（三个面板各不相同），也不参与它们的 flex 布局。
 */
(function () {
    'use strict';

    var MSG_TYPE = '__TAB_KEY_HINT__';

    /* 三个面板的页签条容器：背包 / 烹饪是 .bag-tabs，制造台是 .left-tabs。
       注意 .bag-tabs 不会误命中 .bag-tabs-scroll —— CSS 类选择器按完整 token 匹配。 */
    var TAB_BAR_SELECTOR = '.bag-tabs, .left-tabs';

    /* 与下方 CSS 动画总时长保持一致；改一处必须改另一处 */
    var LIFE_MS = 4200;

    /* 页签条可能还没渲染完（三个面板都是 Vue 异步挂载），轮询等它出现 */
    var POLL_INTERVAL_MS = 100;
    var POLL_MAX_TRIES = 20;      // 2 秒还没出来就放弃，不留悬挂定时器

    var STYLE_ID = 'tabhint-style';
    var NODE_ID = 'tabhint-node';

    /* 当前页面所在目录名（BackpackUI / ToolTable / Cooking）。
       用目录名而不是 UIKey：UIKey 有历史例外（背包的 UIKey 是 "Backpack" 而目录叫 "BackpackUI"），
       目录名从 location 直接取得到，不依赖任何需要两边对齐的约定。 */
    var PAGE_DIR = (function () {
        var parts = window.location.pathname.split('/');
        return parts.length >= 2 ? parts[parts.length - 2] : '';
    })();

    var CSS = [
        '#' + NODE_ID + ' {',
        '    position: fixed;',
        '    z-index: 2147483000;',
        '    display: flex; align-items: center; gap: 7px;',
        '    padding: 3px 9px; border-radius: 6px;',
        '    background: rgba(8, 8, 10, 0.86);',
        '    font-size: 12.5px; line-height: 1.4; color: #e8e2d4;',
        '    white-space: nowrap; pointer-events: none;',
        '    opacity: 0;',
        /* 动画只动 opacity / transform —— CodeGuidelines/webui-effects-performance.md [强制] */
        '    animation: tabhint-life ' + (LIFE_MS / 1000) + 's ease forwards;',
        '}',
        '#' + NODE_ID + ' .tabhint-kbd {',
        '    display: inline-flex; align-items: center; justify-content: center;',
        '    min-width: 22px; height: 22px; padding: 0 6px;',
        '    font-size: 12px; font-weight: 800; line-height: 1;',
        '    color: #ffe6a8;',
        '    background: linear-gradient(180deg, rgba(72, 62, 34, 0.9) 0%, rgba(40, 36, 22, 0.95) 100%);',
        '    border: 1px solid rgba(255, 193, 7, 0.55);',
        '    border-radius: 5px;',
        '    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);',
        '}',
        '@keyframes tabhint-life {',
        '    0%   { opacity: 0; transform: translateY(-4px); }',
        '    9%   { opacity: 1; transform: translateY(0); }',
        '    76%  { opacity: 1; transform: translateY(0); }',
        '    100% { opacity: 0; transform: translateY(0); }',
        '}',
        /* 低画质档去掉位移，只留淡入淡出（一次性动画，不做整体禁用——禁用了提示就等于没有） */
        'html.quality-low #' + NODE_ID + ' { animation-name: tabhint-life-flat; }',
        '@keyframes tabhint-life-flat {',
        '    0%   { opacity: 0; }',
        '    9%   { opacity: 1; }',
        '    76%  { opacity: 1; }',
        '    100% { opacity: 0; }',
        '}'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) { return; }
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    /* 贴在页签条正下方、左端对齐。用 fixed + rect，不进任何面板的布局流。
       没有 unity-interactive class、且 pointer-events:none —— 不会被 clickThrough 的
       collectRects 收进交互区，也就不会挡住玩家点页签。 */
    function place(node, bar) {
        var rect = bar.getBoundingClientRect();
        node.style.left = Math.round(rect.left) + 'px';
        node.style.top = Math.round(rect.bottom + 6) + 'px';
    }

    function show(text) {
        var bar = document.querySelector(TAB_BAR_SELECTOR);
        if (!bar) { return false; }

        /* 页签只有一个时前端根本不渲染页签条，键盘也不响应（各面板 RA_SwitchTabByKey 同款守卫），
           这种局面下提示玩家"可以切页签"是骗人的，直接不出。 */
        if (bar.getBoundingClientRect().width <= 0) { return false; }

        ensureStyle();

        var old = document.getElementById(NODE_ID);
        if (old && old.parentNode) { old.parentNode.removeChild(old); }

        var node = document.createElement('div');
        node.id = NODE_ID;

        var keyA = document.createElement('span');
        keyA.className = 'tabhint-kbd';
        keyA.textContent = 'A';
        var keyD = document.createElement('span');
        keyD.className = 'tabhint-kbd';
        keyD.textContent = 'D';
        var label = document.createElement('span');
        /* 文案由 C# 侧取好随 payload 下发；词条没导表时走这里的中文兜底（i18n-rules 的 OrEmpty 口径） */
        label.textContent = text || '切换左右页签';

        node.appendChild(keyA);
        node.appendChild(keyD);
        node.appendChild(label);
        document.body.appendChild(node);

        place(node, bar);

        /* 一次性 setTimeout，回调只删本页 DOM —— 不发 UnitySendEvent、不做跨页副作用，
           符合 CodeGuidelines/webui-panel-lifecycle.md 对定时器回调的 [强制] 要求。
           页面被 ESC / 业务逻辑从外部关掉时 iframe 直接销毁，定时器随之释放，无需额外清理。 */
        window.setTimeout(function () {
            var self = document.getElementById(NODE_ID);
            if (self && self.parentNode) { self.parentNode.removeChild(self); }
        }, LIFE_MS + 200);

        return true;
    }

    /* 页签条还没挂上来就轮询等，超过上限放弃（面板可能压根没有多页签） */
    function showWhenReady(text) {
        if (show(text)) { return; }
        var tries = 0;
        var timer = window.setInterval(function () {
            tries++;
            if (show(text) || tries >= POLL_MAX_TRIES) {
                window.clearInterval(timer);
            }
        }, POLL_INTERVAL_MS);
    }

    window.addEventListener('message', function (event) {
        var message = event.data;
        if (!message || message.type !== MSG_TYPE) { return; }

        var payload = message.data;
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch (e) { return; }
        }
        if (!payload) { return; }

        /* 只认自己那条（双保险，见文件头说明）：现在是定向投递本不会送错面板，
           保留是防将来通道改回广播时在当天第二、第三个面板重复弹。 */
        if (payload.page !== PAGE_DIR) { return; }

        showWhenReady(payload.text);
    });
})();
