import { useEffect, useState } from "react";
import App from "./App";
import {AGENT_OPEN_EVENT} from './lib/agentConversation';
import baseCss from "./styles.css";
import readerCss from "./reader.css";
import workspaceCss from "./workspace.css";
import {startRenderService} from './lib/renderService';
import {startBusinessLinks} from './lib/businessLinks';
import tokensCss from '../docs/ui/tokens.css';
import libraryCss from './library.css';
const cssText=tokensCss+baseCss+readerCss+workspaceCss+libraryCss;

/**
 * dsh client 插件。契约见 docs/dsh-contracts.md（实测自运行中的 dsh）。
 * 落点：
 *  - `sidebar.footer.action`（list）—— 入口按钮
 *  - `shell.overlay`（list, scope:root, owner props = {}）—— 全屏工作台浮层
 * 不占用 root/sidebar/conversation/details 这四个 single slot（占用即替换官方组件）。
 */

const STYLE_ID = "ooo-bidpliot-style";
function mountStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = cssText;
  el.dataset.plugin = "ooo-bidpliot";
  document.head.appendChild(el);
}
function unmountStyle() { document.getElementById(STYLE_ID)?.remove(); }

// 模块级极简 store：浮层开合。dsh 的 slot 之间没有共享状态通道，用订阅者模式。
const SURFACE_ACTIVATE_EVENT = "dsh:conversation-surface-activate";
const SURFACE_ID = "ooo-bidpliot";
let open = false;
const listeners = new Set<(v: boolean) => void>();
function setOpen(v: boolean) {
  if (v === open) return;
  if (v && !window.dispatchEvent(new CustomEvent(SURFACE_ACTIVATE_EVENT, { cancelable:true, detail: { id: SURFACE_ID, activate:()=>setOpen(true) } }))) return;
  open = v;
  for (const fn of listeners) fn(v);
}
function subscribe(fn: (v: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function SidebarEntry({ wide }: { wide?: boolean }) {
  const [active, setActive] = useState(open);
  useEffect(() => subscribe(setActive), []);
  return (
    <button className="bp-entry" data-active={active} type="button"
      onClick={() => active?window.dispatchEvent(new Event('ooo-bidpliot:request-close')):setOpen(true)} title="ooo-bidpliot">
      <span className="bp-entry-mark">标</span>
      {wide === false ? null : <span>ooo-bidpliot</span>}
    </button>
  );
}

function OverlayRoot() {
  return <App onClose={() => setOpen(false)} />;
}

interface Slots {
  register(options: Record<string, unknown>, component: unknown): () => void;
  inject(name: string, cb: () => void | (() => void)): () => void;
}
interface ClientContext {
  get(name: string): unknown;
  effect(fn: () => void | (() => void), label?: string): void;
}

export function apply(ctx: ClientContext): void {
  const slots = ctx.get("slots") as Slots | undefined;
  if (slots === undefined) return;

  ctx.effect(() => { mountStyle(); return unmountStyle; }, "ooo-bidpliot: style");
  ctx.effect(startRenderService, 'ooo-bidpliot: document rendering');
  ctx.effect(startBusinessLinks, 'ooo-bidpliot: authenticated document links');
  ctx.effect(() => (ctx.get('sessions') as {list:{subscribe:(fn:()=>void)=>()=>void}}).list.subscribe(()=>window.dispatchEvent(new Event('ooo-bidpliot:changed'))), 'ooo-bidpliot: shared project updates');
  ctx.effect(() => {
    const deactivate = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; activate:()=>void }>).detail;
      if (detail?.id && detail.id !== SURFACE_ID && open) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('ooo-bidpliot:request-close',{detail:{afterClose:detail.activate}}));
      }
    };
    window.addEventListener(SURFACE_ACTIVATE_EVENT, deactivate);
    return () => window.removeEventListener(SURFACE_ACTIVATE_EVENT, deactivate);
  }, "ooo-bidpliot: surface coordination");


  ctx.effect(() => {
    const openExecution=(event:Event)=>{
      const {sessionId}=(event as CustomEvent<{sessionId:string}>).detail;
      const afterClose=()=>{
        (ctx.get('uiWorkspace') as {openSession:(id:string)=>void}).openSession(sessionId);
      };
      window.dispatchEvent(new CustomEvent('ooo-bidpliot:request-close',{detail:{afterClose}}));
    };
    window.addEventListener(AGENT_OPEN_EVENT,openExecution);
    return()=>window.removeEventListener(AGENT_OPEN_EVENT,openExecution);
  }, 'ooo-bidpliot: open execution from workbench');


  ctx.effect(
    () => slots.inject("sidebar.footer.action", () =>
      slots.register({ name: "sidebar.footer.action", id: "ooo-bidpliot-entry" }, SidebarEntry)),
    "ooo-bidpliot: sidebar entry",
  );

  // shell.overlay 是 list 型：只在打开时注册，关闭即注销，不常驻占位。
  ctx.effect(
    () => slots.inject("shell.overlay", () => {
      let dispose: (() => void) | undefined;
      const sync = (v: boolean) => {
        if (v && !dispose) {
          dispose = slots.register({ name: "shell.overlay", id: "ooo-bidpliot-workbench" }, OverlayRoot);
        } else if (!v && dispose) {
          dispose(); dispose = undefined;
        }
      };
      sync(open);
      const off = subscribe(sync);
      return () => { off(); dispose?.(); };
    }),
    "ooo-bidpliot: overlay workbench",
  );
}

export const inject = ["slots", "sessions", "uiWorkspace"];
