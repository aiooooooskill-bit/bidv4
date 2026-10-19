/**
 * 目录树编辑纯函数库（2026-09-04 批次 4）：查找 / 升降级。
 * 全部操作直接改写传入的 draft（调用方 mutate 负责 structuredClone 副本），
 * 返回 boolean 表示操作是否成立（非法升降级返回 false）。
 * 层级封顶 5 级（投标目录超过 5 层无写作意义）。
 */

export interface EditNode {
  目录名称: string
  level: number
  children?: EditNode[]
  来源?: string[]
  来源位置?: string[]
  交付形态?: string
  归位理由?: string
  理由来源?: string[]
  节点概述?: string
  _id?: string
}

export interface EditDoc {
  name?: string
  scope?: string
  directory?: EditNode[]
}

/** tender.directory 编辑态数据形状（查看/编辑共用节点类型；registry/meta 等
 *  非树字段原样保留）。契约模型见 sidecar contracts/tender_directory.py。 */
export interface DirectoryData {
  response_documents?: EditDoc[]
  registry?: Record<string, { type?: string; text?: string; 出处?: string }>
  meta?: Record<string, string>
  lineage_check?: { unused_ids?: string[]; dangling_ids?: string[] }
  warning?: string
  /** 章节编号格式（合册按目录树序自动编号时读取；缺省 decimal=1/1.1/1.1.1） */
  numbering?: 'chapter' | 'decimal' | 'gov' | 'none'
  page_target?: number | null
}

export const MAX_LEVEL = 5
const subtreeHeight = (node: EditNode): number => 1 + Math.max(0,...(node.children??[]).map(subtreeHeight))
export function canDemote(docs:EditDoc[],id:string):boolean {
  const addr=findInDocs(docs,id)
  return !!addr&&addr.index>0&&addr.list[addr.index-1].level+subtreeHeight(addr.list[addr.index])<=MAX_LEVEL
}

export interface NodeAddr {
  list: EditNode[]
  index: number
}

export function findInList(list: EditNode[], id: string): NodeAddr | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i]._id === id) return { list, index: i }
    if (list[i].children?.length) {
      const r = findInList(list[i].children!, id)
      if (r) return r
    }
  }
  return null
}

export function findInDocs(docs: EditDoc[], id: string): NodeAddr | null {
  for (const doc of docs) {
    const r = findInList(doc.directory ?? [], id)
    if (r) return r
  }
  return null
}

/** 父节点（根级 parent=null 含分册索引）；节点不存在返回 null。 */
export function findParent(docs: EditDoc[], id: string): { parent: EditNode | null; docIndex: number } | null {
  // 返回 undefined=子树未命中；null=命中且是根级；其他=命中且的直接父节点
  const direct = (list: EditNode[], parent: EditNode | null): EditNode | null | undefined => {
    for (const n of list) {
      if (n._id === id) return parent
      if (n.children?.length) {
        const r = direct(n.children!, n)
        if (r !== undefined) return r
      }
    }
    return undefined
  }
  for (let i = 0; i < docs.length; i++) {
    const r = direct(docs[i].directory ?? [], null)
    if (r !== undefined) return { parent: r, docIndex: i }
  }
  return null
}

/** 整子树 level 重算（移动/升降级后调用）。 */
export function relevel(node: EditNode, level: number): void {
  node.level = level
  for (const c of node.children ?? []) relevel(c, level + 1)
}

/** 升级：上移一层，插到父节点在祖父列表中的位置之后。根级不可升级。 */
export function promote(docs: EditDoc[], id: string): boolean {
  const addr = findInDocs(docs, id)
  if (!addr) return false
  const node = addr.list[addr.index]
  if (node.level <= 1) return false
  const fp = findParent(docs, id)
  if (!fp || !fp.parent) return false
  const parentAddr = findInDocs(docs, fp.parent._id!)
  if (!parentAddr) return false
  const [n] = addr.list.splice(addr.index, 1)
  parentAddr.list.splice(parentAddr.index + 1, 0, n)
  relevel(n, n.level - 1)
  return true
}

/** 降级：成为前一个同级的最后一个子节点。无前同级 / 超封顶不可。 */
export function demote(docs: EditDoc[], id: string): boolean {
  const addr = findInDocs(docs, id)
  if (!addr) return false
  if (!canDemote(docs,id)) return false
  const prev = addr.list[addr.index - 1]
  if (prev.level >= MAX_LEVEL) return false
  const [n] = addr.list.splice(addr.index, 1)
  prev.children = prev.children ?? []
  prev.children.push(n)
  relevel(n, prev.level + 1)
  return true
}

export function moveSibling(docs: EditDoc[], id: string, destination: 'up'|'down'|'top'|'bottom'): boolean {
  const a = findInDocs(docs, id)
  if (!a) return false
  const index = destination === 'top' ? 0 : destination === 'bottom' ? a.list.length-1 : a.index + (destination === 'up' ? -1 : 1)
  if (index < 0 || index >= a.list.length || index === a.index) return false
  const [node] = a.list.splice(a.index, 1)
  a.list.splice(index, 0, node)
  return true
}

export function canMoveTo(docs: EditDoc[], id: string, parentId: string|null): boolean {
  const source = findInDocs(docs, id), owner = findParent(docs, id)
  if (!source || !owner) return false
  if (parentId === null) return true
  const target = findInDocs(docs, parentId), targetOwner = findParent(docs, parentId)
  const node = source.list[source.index]
  return !!target && owner.docIndex === targetOwner?.docIndex && !findInList([node], parentId)
    && target.list[target.index].level + subtreeHeight(node) <= MAX_LEVEL
}

/** 移到同册指定父级；不能移动到自身/后代，也不能超过五层。 */
export function moveTo(docs: EditDoc[], id: string, parentId: string|null): boolean {
  if (!canMoveTo(docs, id, parentId)) return false
  const source = findInDocs(docs, id)!, owner = findParent(docs, id)!
  const parent = parentId === null ? null : findInDocs(docs, parentId)!
  const target = parent ? parent.list[parent.index] : null
  const [node] = source.list.splice(source.index, 1)
  relevel(node, target ? target.level+1 : 1)
  const list = target ? (target.children ??= []) : (docs[owner.docIndex].directory ??= [])
  list.push(node)
  return true
}
