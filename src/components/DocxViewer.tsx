import { quoteRanges } from "../../shared/quote";
import {reportError,clearNotice} from "./NoticeCenter";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { previewAncestorCounters } from "../../shared/preview-numbering";

/**
 * 招标文件原文渲染器。
 *
 * **页码只能来自这里。** 后端 SDK 不提供分页信息（`anchor.page` 恒为 null，
 * `server/analyze/anchor.ts` 明确注释不编造页码）。注意 docx-preview 只在**显式分页符和分节处**
 * 切 `<section class="docx">`，并不按纸张高度重排，所以 section 数不等于页数（实测一个 section
 * 能高到 22000px，而 A4 页框只有 1122px）。页码改为按每节声明的纸张高度切视图页，与肉眼一致。
 *
 * 解读定位使用服务端按唯一原文索引加入的预览书签；文本定位仅供生成稿字段等独立用途。
 */

export interface DocxViewerHandle {
  /** 跳到某段原文并高亮；找不到返回 false */
  locate(quote: string, occurrence?: "first" | "last"): boolean;
}

const HL = "bp-docx-hit";

export function DocxViewer({ src, onReady, locateRef, onFill, fitWidth = false, toolbarActions }: {
  src: string;
  fitWidth?: boolean;
  toolbarActions?: ReactNode;
  onReady?: (pages: number) => void;
  locateRef?: (h: DocxViewerHandle | null) => void;
  onFill?: (key: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 视图页锚点：每个元素是该页在滚动容器里的绝对偏移。长度即总页数。 */
  const [anchors, setAnchors] = useState<number[]>([]);
  const anchorsRef = useRef<number[]>([]);
  anchorsRef.current = anchors;
  const pages = anchors.length;
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const fitted = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const fillRef = useRef(onFill);
  fillRef.current = onFill;

  useEffect(()=>{const id="preview:"+src;if(err)reportError(err,{id,title:"Word预览未完成",retry:()=>setRetry(n=>n+1)});else clearNotice(id);return()=>clearNotice(id);},[err,src]);

  /**
   * 把渲染结果按纸张高度切成视图页，返回总页数。
   * 用 getBoundingClientRect 量，缩放后的几何也能对齐。
   */
  const measure = useCallback((): number => {
    const host = hostRef.current;
    const box = scrollRef.current;
    if (!host || !box) return 0;
    const boxTop = box.getBoundingClientRect().top;
    const next: number[] = [];
    for (const sec of host.querySelectorAll<HTMLElement>("section.docx")) {
      const rect = sec.getBoundingClientRect();
      const scale = sec.offsetHeight ? rect.height / sec.offsetHeight : 1;
      const pageH = parseFloat(getComputedStyle(sec).minHeight) * scale;
      const top = box.scrollTop + rect.top - boxTop;
      // 末页往往不满一页，减一点容差免得多切出一页空白。
      const count = pageH > 1 ? Math.max(1, Math.ceil(rect.height / pageH - 0.02)) : 1;
      for (let i = 0; i < count; i++) next.push(top + i * pageH);
    }
    setAnchors(next);
    setPage((p) => Math.min(Math.max(p, 1), Math.max(1, next.length)));
    return next.length;
  }, []);

  // ── 渲染 ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const host = hostRef.current;
    if (!host) return;
    setLoading(true); setErr(null); setAnchors([]); setPage(1);
    host.innerHTML = "";

    (async () => {
      try {
        const res = await fetch(src, {signal: controller.signal,cache:"no-store"});
        if (!res.ok) {
          const detail = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error || `原文加载失败（${res.status}）`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const { renderAsync } = await import("docx-preview");
        const rendered = document.createElement("div");
        const doc = await renderAsync(blob, rendered, undefined, {
          breakPages: true,
          inWrapper: true,
          ignoreHeight: false,
          experimental: true,
        });
        const firstLevels = new Map<string, number>();
        for (const p of rendered.querySelectorAll('article p')) {
          for (const name of p.classList) {
            const match = /^docx-num-(\d+)-(\d+)$/.exec(name);
            if (match && !firstLevels.has(match[1])) firstLevels.set(match[1], Number(match[2]));
          }
        }
        const counters = previewAncestorCounters(
          [...firstLevels].map(([id, level]) => ({id, level})),
          doc.numberingPart?.domNumberings ?? [],
        );
        const wrapper = rendered.querySelector<HTMLElement>('.docx-wrapper');
        if (wrapper && counters) wrapper.style.setProperty('counter-set', counters);
        if (cancelled) return;
        host.replaceChildren(...rendered.childNodes);
        if (fillRef.current) decorateFills(host, (key) => fillRef.current?.(key));
        const firstPage = host.querySelector<HTMLElement>("section.docx");
        if (fitWidth && !fitted.current && firstPage && scrollRef.current) {
          setZoom(Math.max(.25, Math.min(1, Math.floor((scrollRef.current.clientWidth - 24) / firstPage.offsetWidth * 10) / 10)));fitted.current=true;
        }
        // 可选调用会短路实参，measure 必须单独调用，否则没传 onReady 的宿主永远量不到页数。
        const counted = measure();
        onReady?.(counted);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [src, onReady, fitWidth, retry, measure]);

  // 图片与字体是渲染后才到位的，高度一变页数就得重算；缩放同理。
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);
    return () => observer.disconnect();
  }, [measure]);

  // ── 当前页：按滚动位置推算 ───────────────────────────
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const onScroll = () => {
      const list = anchorsRef.current;
      if (list.length === 0) return;
      const top = box.scrollTop + box.clientHeight * 0.3;
      let cur = 1;
      for (let i = 0; i < list.length; i++) if (list[i] <= top) cur = i + 1;
      // 末页通常不满一页，滚到底也到不了它的页首，这时直接认末页。
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) cur = list.length;
      setPage(cur);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, []);

  /** 超长预览里 smooth 滚动会被浏览器直接放弃（实测跨 2 万像素纹丝不动），远距离改成瞬时跳。 */
  const scrollBox = (box: HTMLElement, top: number) => {
    const far = Math.abs(top - box.scrollTop) > box.clientHeight * 3;
    box.scrollTo({ top, behavior: far ? "auto" : "smooth" });
  };

  const goto = useCallback((n: number) => {
    const box = scrollRef.current;
    const list = anchorsRef.current;
    if (!box || !list.length) return;
    const target = Math.min(Math.max(n, 1), list.length);
    scrollBox(box, Math.max(0, list[target - 1] - 12));
    // 程序化滚动不保证触发 scroll 事件，页码要自己认；手动滚动仍由监听器纠正。
    setPage(target);
  }, []);

  // ── 定位：文本搜索 + 高亮 ────────────────────────────
  const locate = useCallback((quote: string, occurrence: "first" | "last" = "first"): boolean => {
    const host = hostRef.current;
    const box = scrollRef.current;
    if (!host || !box) return false;
    host.querySelectorAll(`.${HL}`).forEach((el) => el.classList.remove(HL));
    const marks = [...host.querySelectorAll<HTMLElement>("[data-fill-key]")].filter(el => el.dataset.fillKey === quote);
    let hits: HTMLElement[];
    if (marks.length) hits = [occurrence === "last" ? marks.at(-1)! : marks[0]];
    else {
      // Text nodes occur once in DOM order. Selecting both p and td would duplicate cell text.
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const texts: string[] = [], owners: HTMLElement[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest("style,script")) continue;
        texts.push(node.textContent ?? "");
        owners.push(parent.closest<HTMLElement>("p,td,li,h1,h2,h3,h4,h5,h6") ?? parent);
      }
      const ranges = quoteRanges(texts, quote);
      const range = occurrence === "last" ? ranges.at(-1) : ranges[0];
      hits = range ? [...new Set(range.segmentIndexes.map(i => owners[i]))] : [];
    }
    if (!hits.length) return false;
    hits.forEach(el => el.classList.add(HL));
    const hit = hits[0];
    const top = box.scrollTop + hit.getBoundingClientRect().top - box.getBoundingClientRect().top;
    scrollBox(box, top - box.clientHeight / 3);
    return true;
  }, []);

  useEffect(() => {
    locateRef?.({ locate });
    return () => locateRef?.(null);
  }, [locate, locateRef]);

  return (
    <div className="bp-docx">
      <div className="bp-docx-bar">
        <button className="bp-icon-btn" title="缩小" disabled={zoom <= 0.25}
          onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}>−</button>
        <input className="bp-docx-zoom" type="range" min={25} max={200} step={5}
          value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} />
        <button className="bp-icon-btn" title="放大" disabled={zoom >= 2}
          onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>+</button>
        <span className="bp-muted">{Math.round(zoom * 100)}%</span>
        <span className="bp-spacer" />
        {toolbarActions}
        <button className="bp-btn" disabled={page <= 1} onClick={() => goto(page - 1)}>‹ 上一页</button>
        <span className="bp-muted">第 {pages ? page : 0} / {pages} 页</span>
        <button className="bp-btn" disabled={page >= pages} onClick={() => goto(page + 1)}>下一页 ›</button>
      </div>
      <div className="bp-docx-scroll" ref={scrollRef}>
        {loading ? <div className="bp-empty">正在更新预览…</div> : null}
        
        <div className="bp-docx-zoomwrap" style={{ transform: `scale(${zoom})` }}>
          <div ref={hostRef} />
        </div>
      </div>
    </div>
  );
}

function decorateFills(host: HTMLElement, onFill: (key: string) => void): void {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = []; let next: Node | null;
  while ((next = walker.nextNode())) if (/\[\[[^\[\]\n]{1,500}\]\]/.test(next.textContent ?? "")) nodes.push(next as Text);
  for (const node of nodes) {
    const parts = (node.textContent ?? "").split(/(\[\[[^\[\]\n]{1,500}\]\])/g);
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      const match = part.match(/^\[\[([^\[\]|\n]{1,160})(?:\|([^\[\]\n]{1,320}))?\]\]$/);
      if (!match) { fragment.append(document.createTextNode(part)); continue; }
      const button = document.createElement("button"); button.type = "button";
      button.className = `bp-docx-fill${match[2] ? " bp-fill-filled" : ""}`;
      button.dataset.fillKey = match[1].trim(); button.title = match[1].trim();
      button.textContent = `${match[2] ?? (/签字|盖章|签章/.test(match[1]) ? "待签章" : "填写")} ✎`;
      button.addEventListener("click", () => onFill(match[1].trim())); fragment.append(button);
    }
    node.parentNode?.replaceChild(fragment, node);
  }
}
