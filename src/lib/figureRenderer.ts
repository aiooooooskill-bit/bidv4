// Adapted from joychin/LingYan-Bid-Agent frontend/src/lib/htmlRenderer.ts
// MIT; upstream commit de909f12572b4c469864b12255e26cc185ada7ec.
/** 渲染视口宽（px）：接近 A4 版心 2x 视觉密度，原型按桌面端界面画。 */
export const RENDER_WIDTH = 1200
/** 字体/布局稳定等待（ms）：iframe load 后立刻截会丢字体。 */
const SETTLE_MS = 300

/**
 * wrapper 页构造（纯函数，可测）：CSP + 基础 reset + 模型 HTML + 角标。
 * 模型 HTML 已在 sidecar 剥过 script/iframe/on*（这里不重复剥——双剥易误伤，
 * CSP 是兜底层）。
 */
export function buildWrapperDoc(html: string, width = RENDER_WIDTH): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { width: ${width}px; font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif; color: #1f2328; font-size: 15px; line-height: 1.6; }
#proto-root { padding: 24px; min-height: 120px; }
.__proto_badge { position: fixed; right: 0; bottom: 0; padding: 4px 14px; background: rgba(31,35,40,.55); color: #ffffff; font-size: 14px; border-top-left-radius: 6px; }
</style></head>
<body><div id="proto-root">${html}</div><div class="__proto_badge">界面原型 · 示意图</div></body></html>`
}

/** 渲染一段（已清洗的）HTML 为 PNG Blob。任何失败抛错（调用方回执失败）。 */
export async function renderHtmlToPng(html: string): Promise<Blob> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${RENDER_WIDTH}px;height:800px;border:0;visibility:hidden;`
  iframe.srcdoc = buildWrapperDoc(html)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('iframe 加载超时')), 10_000)
      iframe.addEventListener('load', () => { clearTimeout(timer); resolve() }, { once: true })
      document.body.appendChild(iframe)
    })
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    const doc = iframe.contentDocument
    if (!doc?.body) throw new Error('iframe 文档不可读（同源沙箱失效）')
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(doc.body, {
      scale: 2,
      backgroundColor: '#ffffff',
      width: RENDER_WIDTH,
      windowWidth: RENDER_WIDTH,
    })
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('canvas 导出为空')
    return blob
  } finally {
    iframe.remove()
  }
}

let _mermaid_ready: Promise<typeof import('mermaid')['default']> | null = null

/** mermaid 初始化（单例；strict=标签转义防注入，neutral=灰阶打印友好主题）。 */
function mermaidLib() {
  if (!_mermaid_ready) {
    _mermaid_ready = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'neutral',
        fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        // 紧凑排版（2026-09-14 实测）：默认 50/50 的间距把 TD 长链撑得极高，
        // 配合 sidecar 插图 18cm 高度封顶（显示层兜底，两层各治一半）
        flowchart: { nodeSpacing: 28, rankSpacing: 36, padding: 6 },
      })
      return mermaid
    })
  }
  return _mermaid_ready
}

/** mermaid 文本（sidecar 程序从 JSON 拓扑翻译）→ PNG Blob。
 * mermaid 是可信库在应用上下文执行（非模型代码——不经沙箱 iframe，沙箱禁脚本
 * 跑不了 JS 库）；strict 档转义标签 + 输入本就出自我们校验过的 JSON，双保险。
 * 尺寸从 viewBox 取真实逻辑尺寸并显式回写 width/height——mermaid 的 SVG 自带
 * width="100%"/max-width，<img> 解码的 naturalWidth 会缩成百像素级，按它定
 * 画布=进 Word 糊（实测 204×300）；按 viewBox×3 光栅化（矢量在绘制尺寸光栅化，
 * 放大不糊），3x 兼顾边标签字号（实机验证 2026-09-14）。 */
export async function renderMermaidToPng(mermaidText: string): Promise<Blob> {
  const mermaid = await mermaidLib()
  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.cssText = 'position:fixed;left:-99999px;top:0;'
  document.body.appendChild(container)
  let svg: string
  try {
    svg = (await mermaid.render(`m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, mermaidText, container)).svg
  } finally {
    container.remove()
  }
  const svgDoc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = svgDoc.documentElement
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const w = Number.isFinite(vb[2]) && vb[2] > 0 ? vb[2] : 600
  const h = Number.isFinite(vb[3]) && vb[3] > 0 ? vb[3] : 400
  root.setAttribute('width', String(w))
  root.setAttribute('height', String(h))
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('mermaid SVG 无法解码'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
  })
  const SCALE = 3
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * SCALE)
  canvas.height = Math.round(h * SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('canvas 导出为空')
  return blob
}
