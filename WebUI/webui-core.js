(function(global) {
    'use strict';

    function createWebUICore(pageId) {
        const messageHandlers = {};

        const sendMessage = (action, data = {}) => {
            const message = { type: action, data: data, sourcePageId: pageId };
            if (window.parent) {
                window.parent.postMessage(message, '*');
            }
        };

        const UnitySendEvent = (action, extraData = {}) => {
            sendMessage(action, extraData);
        };

        const registerHandlers = (handlers) => {
            Object.assign(messageHandlers, handlers);
        };

        const initMessageListener = () => {
            window.addEventListener('message', (event) => {
                const message = event.data;
                if (!message) return;

                if (message.type === '__CLICK_PASSTHROUGH__') {
                    if (message.sourcePageId === pageId) return;
                    if (inspector.isActive()) {
                        inspector.handlePoint(message.clientX, message.clientY, true);
                        return;
                    }
                    const el = document.elementFromPoint(message.clientX, message.clientY);
                    console.log('[bug][passthrough] ' + pageId + ' received', message.clientX, message.clientY, '→ el=', el, 'pe=', el ? getComputedStyle(el).pointerEvents : 'N/A');
                    if (el && getComputedStyle(el).pointerEvents !== 'none') {
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                    return;
                }

                if (message.type === '__INSPECT_MODE__') {
                    const d = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                    if (d && d.on) { inspector.start(); } else { inspector.stop(); }
                    return;
                }

                if (message.type === '__QUALITY_TIER__') {
                    const d = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                    const root = document.documentElement;
                    root.classList.remove('quality-low', 'quality-medium');
                    if (d && d.tier) { root.classList.add('quality-' + d.tier); }
                    return;
                }

                if (message.type === '__CHEAT_MARK__') {
                    const d = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
                    document.documentElement.classList.toggle('cheat-marked', !!(d && d.on));
                    return;
                }

                const handler = messageHandlers[message.type];
                if (handler) {
                    const data = typeof message.data === 'string'
                        ? JSON.parse(message.data)
                        : message.data;
                    handler(data);
                }
            });
        };

        const notifyReady = () => {
            let sent = false;
            const sendOnce = () => {
                if (sent) return;
                sent = true;
                try {
                    if (window.parent && window.parent.notifyPageReady) {
                        window.parent.notifyPageReady(pageId);
                        return;
                    }
                } catch (e) {
                }
                if (window.parent) {
                    window.parent.postMessage({ type: '__PAGE_READY__', sourcePageId: pageId }, '*');
                }
            };
            requestAnimationFrame(() => requestAnimationFrame(sendOnce));
            setTimeout(sendOnce, 150);
        };

        const i18n = {
            updateText: (selector, text) => {
                const el = document.querySelector(selector);
                if (el && text) {
                    el.textContent = text;
                }
            },

            updateTooltip: (selector, text) => {
                const el = document.querySelector(selector);
                if (el && text) {
                    el.setAttribute('data-tooltip', text);
                }
            }
        };

        initMessageListener();

        // clip: null = 不裁; { pad } = 让 Root 把本页 iframe 的 DOM 命中范围裁到 rects 包围盒外扩 pad px(见 Root.html applyFrameClip)
        const syncInteractiveRects = (rects, clip = null) => {
            try {
                if (window.parent && window.parent.syncInteractiveRects) {
                    window.parent.syncInteractiveRects(pageId, rects, clip);
                    return;
                }
            } catch (e) {
            }
            if (window.parent) {
                window.parent.postMessage({ type: '__SYNC_RECTS__', sourcePageId: pageId, rects: rects, clip: clip }, '*');
            }
        };

        const clickThrough = (function() {
            const config = {
                debounceMs: 100,
                selector: '.unity-interactive, button, input, select, a, [data-interactive]'
            };

            let syncTimer = null;
            let observer = null;
            let isRunning = false;
            let frameClip = null; // { pad } = 已请求 Root 裁切本页 iframe 命中范围(见 setFrameClip)

            function collectRects() {
                const rects = [];
                const elements = document.querySelectorAll(config.selector);

                elements.forEach(el => {
                    const style = getComputedStyle(el);

                    if (style.pointerEvents === 'none' ||
                        style.visibility === 'hidden' ||
                        style.display === 'none' ||
                        el.disabled) {
                        return;
                    }

                    const rect = el.getBoundingClientRect();

                    if (rect.width <= 0 || rect.height <= 0) return;
                    if (rect.right < 0 || rect.bottom < 0) return;
                    if (rect.left > window.innerWidth || rect.top > window.innerHeight) return;

                    rects.push({
                        x: Math.max(0, rect.left / window.innerWidth),
                        y: Math.max(0, rect.top / window.innerHeight),
                        w: Math.min(rect.width / window.innerWidth, 1),
                        h: Math.min(rect.height / window.innerHeight, 1)
                    });
                });

                return rects;
            }

            function debounceSyncRects() {
                if (!isRunning) return;

                if (syncTimer) return;
                syncTimer = setTimeout(() => {
                    syncTimer = null;
                    syncInteractiveRects(collectRects(), frameClip);
                }, config.debounceMs);
            }

            function syncNow() {
                if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
                syncInteractiveRects(collectRects(), frameClip);
            }

            function syncNowAfterReflow() {
                if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
                requestAnimationFrame(() => {
                    syncInteractiveRects(collectRects(), frameClip);
                });
            }

            function start(options = {}) {
                if (isRunning) return;
                isRunning = true;

                if (options.debounceMs) config.debounceMs = options.debounceMs;
                if (options.selector) config.selector = options.selector;

                syncNow();

                observer = new MutationObserver((mutations) => {
                    for (let i = 0; i < mutations.length; i++) {
                        const t = mutations[i].target;
                        if (t && t.nodeType === 1 && t.closest && t.closest('[data-no-sync]')) continue;
                        debounceSyncRects();
                        return;
                    }
                });
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['style', 'class', 'disabled', 'hidden']
                });

                window.addEventListener('resize', debounceSyncRects);
                window.addEventListener('scroll', debounceSyncRects);
            }

            function stop() {
                if (!isRunning) return;
                isRunning = false;

                if (syncTimer) {
                    clearTimeout(syncTimer);
                    syncTimer = null;
                }

                if (observer) {
                    observer.disconnect();
                    observer = null;
                }

                window.removeEventListener('resize', debounceSyncRects);
                window.removeEventListener('scroll', debounceSyncRects);

                syncInteractiveRects([], frameClip);
            }

            /**
             * 让 Root 把本页 iframe 的 DOM 命中范围裁到交互矩形包围盒(外扩 padPx, 默认 24)。
             * 解决的是 Unity 层 Calculate 已放行、但全屏 iframe 仍在 DOM 层截住下层 iframe 点击的问题:
             * 页面内 CSS 管不到 iframe 元素本身, 只有 Root 改 iframe 的 clip-path 才能让矩形外的点击真正落到下层。
             * clip-path 同时裁渲染: 只对可见内容全在交互元素内的浮层开启; Block 全屏档必须传 false。
             */
            function setFrameClip(enabled, padPx) {
                const next = enabled ? { pad: typeof padPx === 'number' ? padPx : 24 } : null;
                if ((next ? next.pad : -1) === (frameClip ? frameClip.pad : -1)) return;
                frameClip = next;
                syncInteractiveRects(isRunning ? collectRects() : [], frameClip);
            }

            return { start, stop, syncNow, syncNowAfterReflow, collectRects, setFrameClip };
        })();

        const inspector = (function() {
            let active = false;
            let box = null;
            let label = null;
            let peStyle = null;

            function injectPeFix() {
                if (peStyle) return;
                peStyle = document.createElement('style');
                peStyle.setAttribute('data-inspect-pe-fix', '');
                peStyle.textContent = '* { pointer-events: auto !important; }\n'
                    + '[data-no-sync], [data-no-sync] * { pointer-events: none !important; }';
                document.head.appendChild(peStyle);
            }

            function removePeFix() {
                if (!peStyle) return;
                peStyle.remove();
                peStyle = null;
                clickThrough.syncNowAfterReflow();
            }

            function ensureOverlay() {
                if (box) return;
                box = document.createElement('div');
                box.setAttribute('data-no-sync', '');
                box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:none;'
                    + 'border:2px solid #FFC107;background:rgba(255,193,7,0.12);box-sizing:border-box;border-radius:2px;';
                label = document.createElement('div');
                label.setAttribute('data-no-sync', '');
                label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;'
                    + 'background:rgba(20,16,8,0.92);color:#FFE082;font:12px/1.6 Consolas,monospace;'
                    + 'padding:2px 8px;border:1px solid rgba(255,193,7,0.5);border-radius:3px;'
                    + 'max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                document.documentElement.appendChild(box);
                document.documentElement.appendChild(label);
            }

            function describeEl(el) {
                if (!el || !el.tagName) return '';
                let s = el.tagName.toLowerCase();
                if (el.id) s += '#' + el.id;
                if (el.classList && el.classList.length) s += '.' + Array.from(el.classList).slice(0, 3).join('.');
                return s;
            }

            function domPath(el, maxDepth) {
                const parts = [];
                let cur = el, d = 0;
                while (cur && cur !== document.body && cur.nodeType === 1 && d < (maxDepth || 8)) {
                    parts.unshift(describeEl(cur));
                    cur = cur.parentElement; d++;
                }
                return parts.join(' > ');
            }

            function onMove(e) {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                if (!el || el === document.body || el === document.documentElement) {
                    box.style.display = 'none'; label.style.display = 'none';
                    return;
                }
                const r = el.getBoundingClientRect();
                box.style.display = 'block';
                box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
                box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
                label.style.display = 'block';
                label.textContent = pageId + ' ▸ ' + describeEl(el);
                label.style.left = Math.min(e.clientX + 14, window.innerWidth - 280) + 'px';
                label.style.top = Math.min(e.clientY + 18, window.innerHeight - 30) + 'px';
            }

            function collect(clientX, clientY, viaPassthrough) {
                const el = document.elementFromPoint(clientX, clientY);
                const meaningful = !!(el && el !== document.body && el !== document.documentElement);
                const payload = {
                    page: pageId,
                    file: location.pathname.split('/').pop() || '',
                    clientX: clientX,
                    clientY: clientY,
                    nx: clientX / window.innerWidth,
                    ny: clientY / window.innerHeight,
                    viaPassthrough: !!viaPassthrough,
                    meaningful: meaningful
                };
                if (meaningful) {
                    const r = el.getBoundingClientRect();
                    const i18nEl = el.closest('[data-i18n]');
                    payload.el = {
                        desc: describeEl(el),
                        domPath: domPath(el),
                        text: (el.innerText || el.textContent || '').trim().slice(0, 120),
                        i18n: i18nEl ? i18nEl.getAttribute('data-i18n') : null,
                        dataset: Object.assign({}, el.dataset),
                        rectPx: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
                        fullViewport: r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.95
                    };
                }
                sendMessage('__INSPECT_PICK__', payload);
            }

            function handlePoint(clientX, clientY, viaPassthrough) {
                if (!active) return;
                collect(clientX, clientY, viaPassthrough);
                if (!viaPassthrough && window.parent) {
                    window.parent.postMessage({
                        type: '__CLICK_PASSTHROUGH__',
                        sourcePageId: pageId,
                        clientX: clientX,
                        clientY: clientY
                    }, '*');
                }
            }

            function onClick(e) {
                e.preventDefault();
                e.stopImmediatePropagation();
                handlePoint(e.clientX, e.clientY, false);
            }

            function swallow(e) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }

            function start() {
                if (active) return;
                active = true;
                ensureOverlay();
                injectPeFix();
                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('click', onClick, true);
                document.addEventListener('mousedown', swallow, true);
                document.addEventListener('mouseup', swallow, true);
                document.addEventListener('pointerdown', swallow, true);
                document.addEventListener('pointerup', swallow, true);
                console.log('[bug][指认] ' + pageId + ' 检查模式 ON');
            }

            function stop() {
                if (!active) return;
                active = false;
                removePeFix();
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('click', onClick, true);
                document.removeEventListener('mousedown', swallow, true);
                document.removeEventListener('mouseup', swallow, true);
                document.removeEventListener('pointerdown', swallow, true);
                document.removeEventListener('pointerup', swallow, true);
                if (box) { box.style.display = 'none'; label.style.display = 'none'; }
                console.log('[bug][指认] ' + pageId + ' 检查模式 OFF');
            }

            return { start: start, stop: stop, handlePoint: handlePoint, isActive: function() { return active; } };
        })();

        return {
            sendMessage,
            UnitySendEvent,
            registerHandlers,
            notifyReady,
            pageId,
            i18n,
            syncInteractiveRects,
            clickThrough,
            createCountdownEngine,
            createClockEngine,
            createProgressEngine,
            formatTime,
            escapeHtml,
            safeHtml,
            fitText,
            fitTextBox
        };
    }

    // 文案放不下时的自适应（按译文长度变化的标题、按钮等）：
    //   单行先等比缩字号（字距同比）到 singleLineMin → 允许折到 maxLines 行并继续缩到 minScale
    //   → 仍放不下且 ellipsis 开着时截成省略号，鼠标悬停时用自绘气泡显示全文。
    // 每档缩放都要量一次排版，只在文案到达或变化时调（Vue.nextTick + requestAnimationFrame 之后量），不要放进每帧路径。
    // opts：maxLines(2) minScale(0.75) singleLineMin(默认 = minScale) budgetH(默认元素高) availW(默认内容宽) ellipsis(true)
    // 多行省略号用 -webkit-line-clamp，会把元素 display 临时改成 -webkit-box；下次调用先复原再量。
    function fitText(el, opts) {
        if (!el) return;
        const o = Object.assign({ maxLines: 2, minScale: 0.75, singleLineMin: 0, budgetH: 0, availW: 0, ellipsis: true }, opts);
        clearFitEllipsis(el);
        el.style.fontSize = '';
        el.style.letterSpacing = '';
        el.style.whiteSpace = '';
        const cs = getComputedStyle(el);
        const baseFS = parseFloat(cs.fontSize) || 0;
        const baseLS = parseFloat(cs.letterSpacing) || 0;
        if (!baseFS) return;
        const availW = o.availW || (el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
        const budgetH = o.budgetH || el.clientHeight;
        const singleMin = o.singleLineMin || o.minScale;

        const apply = (s) => {
            el.style.fontSize = (baseFS * s).toFixed(2) + 'px';
            el.style.letterSpacing = (baseLS * s).toFixed(2) + 'px';
        };
        const contentBox = () => {
            const rg = document.createRange();
            rg.selectNodeContents(el);
            const b = rg.getBoundingClientRect();
            const tops = new Set();
            for (const r of rg.getClientRects()) { if (r.height > 2) tops.add(Math.round(r.top)); }
            return { w: b.width, h: b.height, lines: tops.size || 1 };
        };

        el.style.whiteSpace = 'nowrap';
        for (let s = 1; s >= singleMin - 1e-6; s -= 0.02) {
            apply(s);
            if (contentBox().w <= availW + 1) return;
        }
        if (o.maxLines <= 1) {
            apply(singleMin);
            if (o.ellipsis && contentBox().w > availW + 1) setFitEllipsis(el, 1);
            return;
        }

        el.style.whiteSpace = 'normal';
        for (let s = 1; s >= o.minScale - 1e-6; s -= 0.02) {
            apply(s);
            const b = contentBox();
            if (b.lines <= o.maxLines && b.h <= budgetH + 1) return;
        }
        apply(o.minScale);
        if (o.ellipsis) {
            const b = contentBox();
            if (b.lines > o.maxLines || b.h > budgetH + 1) setFitEllipsis(el, o.maxLines);
        }
    }

    function setFitEllipsis(el, lines) {
        el.style.overflow = 'hidden';
        el.style.textOverflow = 'ellipsis';
        if (lines <= 1) {
            el.style.whiteSpace = 'nowrap';
        } else {
            el.style.display = '-webkit-box';
            el.style.webkitBoxOrient = 'vertical';
            el.style.webkitLineClamp = String(lines);
        }
        el.dataset.fitEllipsis = '1';
        // 悬停监听每个元素只挂一次；没被截断时回调直接返回
        if (!el.__fitTipBound) {
            el.__fitTipBound = true;
            el.addEventListener('mouseenter', () => showFitTip(el));
            el.addEventListener('mouseleave', hideFitTip);
        }
    }

    function clearFitEllipsis(el) {
        if (el.dataset.fitEllipsis !== '1') return;
        el.style.overflow = '';
        el.style.textOverflow = '';
        el.style.display = '';
        el.style.webkitBoxOrient = '';
        el.style.webkitLineClamp = '';
        delete el.dataset.fitEllipsis;
        hideFitTip();
    }

    // 省略号的"悬停看全文"不能用原生 title：离屏渲染的 WebView 里原生 tooltip 不进画面。
    // 改用整页共享的一个自绘气泡：第一次用到时创建，之后只切 opacity，不随悬停反复创建 / 销毁；
    // 文字按纯文本写入；只在进入 / 离开时量一次位置，不跟手。
    let fitTipEl = null;

    function getFitTip() {
        if (fitTipEl) return fitTipEl;
        fitTipEl = document.createElement('div');
        fitTipEl.className = 'fit-text-tip';
        // 纯视觉层：样式变化不触发交互区域重算
        fitTipEl.setAttribute('data-no-sync', '');
        Object.assign(fitTipEl.style, {
            position: 'fixed', left: '0px', top: '0px', zIndex: '99999',
            maxWidth: '360px', padding: '6px 10px', boxSizing: 'border-box',
            background: 'rgba(18, 18, 20, 0.96)', border: '1px solid #3a3a3a', borderRadius: '4px',
            color: '#e8e8e8', fontSize: '14px', lineHeight: '1.4',
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            pointerEvents: 'none', opacity: '0', transition: 'opacity 0.12s'
        });
        document.body.appendChild(fitTipEl);
        return fitTipEl;
    }

    function showFitTip(el) {
        if (el.dataset.fitEllipsis !== '1') return;
        const tip = getFitTip();
        tip.textContent = el.textContent;
        // body 可能整体缩放：元素矩形是缩放后的像素，气泡挂在 body 下要换回缩放前的坐标
        const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth / zoom;
        const vh = window.innerHeight / zoom;
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        // 默认放在元素下方，底部放不下翻到上方；横向夹在视口内
        let top = r.bottom / zoom + 4;
        if (top + th > vh) top = r.top / zoom - th - 4;
        const left = Math.max(4, Math.min(r.left / zoom, vw - tw - 4));
        tip.style.left = left + 'px';
        tip.style.top = Math.max(4, top) + 'px';
        tip.style.opacity = '1';
    }

    function hideFitTip() {
        if (fitTipEl) fitTipEl.style.opacity = '0';
    }

    // 固定尺寸框内的字号自适应：从 max px 往下二分，找不溢出（scrollWidth / scrollHeight 不超出）的最大字号，最小到 min px。
    // 与 fitText 的区别：不按行数判断，适合宽高都由布局定死的文本框。调用时机要求同 fitText。
    function fitTextBox(el, max, min) {
        if (!el) return;
        el.style.fontSize = max + 'px';
        if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return;
        var lo = min, hi = max - 1, best = min;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            el.style.fontSize = mid + 'px';
            if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        el.style.fontSize = best + 'px';
    }

    // 文案（词条表 / C# 下发）拼进 innerHTML / v-html 之前一律经这两个函数，不直接插原文。
    // 纯文本用 escapeHtml；词条自带排版标签时用 safeHtml。
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 先整体转义，再只放行词条里用到的排版写法：<b> </b>、<br>（<br/> <br /> 统一成 <br>）、&nbsp;。
    // <color=…> 是 Unity 富文本，在 HTML 里本来就不显示颜色，去掉后视觉不变。
    function safeHtml(s) {
        return escapeHtml(s)
            .replace(/&lt;color=(?:(?!&gt;).){0,40}&gt;|&lt;\/color&gt;/gi, '')
            .replace(/&lt;(\/?)b&gt;/gi, '<$1b>')
            .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
            .replace(/&amp;nbsp;/g, '&nbsp;');
    }

    function formatTime(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }

    function createCountdownEngine(options = {}) {
        const config = {
            onTick: options.onTick || (() => {}),
            onComplete: options.onComplete || (() => {}),
            formatFn: options.formatFn || formatTime
        };

        let remainSeconds = 0;
        let timeScale = 1;
        let lastTimestamp = 0;
        let running = false;
        let paused = false;
        let lastFormatted = null;

        function tick(timestamp) {
            if (!running) return;
            if (lastTimestamp === 0) {
                lastTimestamp = timestamp;
                requestAnimationFrame(tick);
                return;
            }
            const dt = (timestamp - lastTimestamp) / 1000;
            lastTimestamp = timestamp;

            if (!paused && remainSeconds > 0) {
                remainSeconds -= dt * timeScale;
                if (remainSeconds < 0) remainSeconds = 0;
                const formatted = config.formatFn(remainSeconds);
                if (formatted !== lastFormatted) {
                    lastFormatted = formatted;
                    config.onTick(remainSeconds, formatted);
                }
                if (remainSeconds <= 0) {
                    config.onComplete();
                }
            }
            requestAnimationFrame(tick);
        }

        return {
            start(seconds, scale = 1) {
                remainSeconds = seconds;
                timeScale = scale;
                lastFormatted = config.formatFn(remainSeconds);
                config.onTick(remainSeconds, lastFormatted);
                if (!running) {
                    running = true;
                    lastTimestamp = 0;
                    requestAnimationFrame(tick);
                }
            },
            stop() {
                running = false;
                lastTimestamp = 0;
            },
            pause(isPause) { paused = isPause; },
            setTimeScale(scale) { timeScale = scale; },
            getRemainSeconds() { return remainSeconds; },
            setRemainSeconds(seconds) {
                remainSeconds = seconds;
                lastFormatted = config.formatFn(remainSeconds);
                config.onTick(remainSeconds, lastFormatted);
            }
        };
    }

    function createClockEngine(options = {}) {
        const config = {
            onTick: options.onTick || (() => {})
        };

        let totalSeconds = 0;
        let maxSeconds = 0;
        let currentTimeScale = 1;
        let lastTimestamp = 0;
        let running = false;
        let paused = false;
        let lastHour = -1;
        let lastMinute = -1;

        function syncFromSeconds(skipIfUnchanged) {
            const hour = Math.floor(totalSeconds / 3600) % 24;
            const minute = Math.floor((totalSeconds % 3600) / 60);
            if (skipIfUnchanged && hour === lastHour && minute === lastMinute) return;
            lastHour = hour;
            lastMinute = minute;
            config.onTick(hour, minute);
        }

        function tick(timestamp) {
            if (!running) return;
            if (lastTimestamp === 0) {
                lastTimestamp = timestamp;
                requestAnimationFrame(tick);
                return;
            }
            const dt = (timestamp - lastTimestamp) / 1000;
            lastTimestamp = timestamp;

            if (!paused && maxSeconds > 0) {
                const speed = 86400 / maxSeconds;
                totalSeconds += dt * speed * currentTimeScale;
                if (totalSeconds >= 86400) totalSeconds -= 86400;
                if (totalSeconds < 0) totalSeconds = 0;
                syncFromSeconds(true);
            }
            requestAnimationFrame(tick);
        }

        return {
            start() {
                if (running) return;
                running = true;
                lastTimestamp = 0;
                requestAnimationFrame(tick);
            },
            stop() {
                running = false;
                lastTimestamp = 0;
            },
            pause(isPause) {
                paused = isPause;
                if (isPause) lastTimestamp = 0;
            },
            reset(newTotalSeconds, newMaxSeconds) {
                totalSeconds = newTotalSeconds;
                if (newMaxSeconds !== undefined && newMaxSeconds > 0) {
                    maxSeconds = newMaxSeconds;
                }
                lastTimestamp = 0;
                syncFromSeconds();
            },
            setTimeScale(scale) { currentTimeScale = scale; },
            getTotalSeconds() { return totalSeconds; },
            getMaxSeconds() { return maxSeconds; },
            getTimeScale() { return currentTimeScale; },
            syncFromSeconds
        };
    }

    function createProgressEngine(options = {}) {
        const config = {
            onTick: options.onTick || (() => {}),
            quantize: options.quantize > 0 ? options.quantize : 0.005
        };

        let startPercent = 0;
        let totalDurationMs = 0;
        let remainingMs = 0;
        let currentPercent = 0;
        let currentTimeScale = 1;
        let running = false;
        let paused = false;
        let lastTimestamp = 0;
        let lastEmitted = -1;

        function tick(timestamp) {
            if (!running) return;

            if (lastTimestamp === 0) {
                lastTimestamp = timestamp;
                requestAnimationFrame(tick);
                return;
            }

            const dt = timestamp - lastTimestamp;
            lastTimestamp = timestamp;

            if (!paused && remainingMs > 0) {
                remainingMs -= dt * currentTimeScale;
                if (remainingMs < 0) remainingMs = 0;

                if (totalDurationMs > 0) {
                    const progress = 1 - (remainingMs / totalDurationMs);
                    currentPercent = startPercent * (1 - progress);
                } else {
                    currentPercent = 0;
                }

                const quantized = Math.round(currentPercent / config.quantize) * config.quantize;
                if (quantized !== lastEmitted) {
                    lastEmitted = quantized;
                    config.onTick(quantized);
                }
            }

            requestAnimationFrame(tick);
        }

        return {
            start() {
                if (running) return;
                running = true;
                lastTimestamp = 0;
                requestAnimationFrame(tick);
            },

            stop() {
                running = false;
                lastTimestamp = 0;
            },

            pause(isPause) {
                paused = isPause;
                if (isPause) {
                    lastTimestamp = 0;
                }
            },

            reset(newPercent, durationMs) {
                startPercent = newPercent;
                currentPercent = newPercent;
                totalDurationMs = durationMs;
                remainingMs = durationMs;
                lastTimestamp = 0;
                lastEmitted = Math.round(newPercent / config.quantize) * config.quantize;
                config.onTick(newPercent);
            },

            setScale(newScale) {
                if (newScale === currentTimeScale) return;
                currentTimeScale = newScale;
            },

            getPercent() { return currentPercent; },
            getTimeScale() { return currentTimeScale; }
        };
    }

    const RES_IMG_EXTS = ['.webp', '.png', '.jpeg', '.jpg'];

    function tryNextResImageExt(img) {
        const src = img.getAttribute('src') || '';
        if (src.indexOf('/Res/') < 0) return false;

        const q = src.search(/[?#]/);
        const path = q < 0 ? src : src.slice(0, q);
        const tail = q < 0 ? '' : src.slice(q);
        const slash = path.lastIndexOf('/');
        const dot = path.lastIndexOf('.');
        if (dot <= slash) return false;
        const base = path.slice(0, dot);
        const curExt = path.slice(dot).toLowerCase();

        let tried = img.__resTriedExts;
        if (!tried || img.__resTriedBase !== base) {
            tried = img.__resTriedExts = [];
            img.__resTriedBase = base;
        }
        if (tried.indexOf(curExt) < 0) tried.push(curExt);

        for (let i = 0; i < RES_IMG_EXTS.length; i++) {
            const ext = RES_IMG_EXTS[i];
            if (tried.indexOf(ext) >= 0) continue;
            tried.push(ext);
            img.setAttribute('src', base + ext + tail);
            return true;
        }
        img.setAttribute('data-res-missing', '1');
        img.dispatchEvent(new CustomEvent('res-image-missing', { bubbles: true }));
        return false;
    }

    document.addEventListener('error', function (e) {
        const t = e.target;
        if (!t || t.tagName !== 'IMG') return;
        if (tryNextResImageExt(t)) {
            e.stopPropagation();
        }
    }, true);

    global.createWebUICore = createWebUICore;
    global.tryNextResImageExt = tryNextResImageExt;

})(window);
