export const contextMenuIcons = [
  'DocumentCopy',
  'FolderOpened',
  'RefreshLeft',
  'Star',
  'Top',
  'Delete',
  'Download',
  'Close',
  'Position',
  'ChatLineSquare',
] as const;

export type ContextMenuIcon = (typeof contextMenuIcons)[number];
export type ContextMenuItemClass =
  '' | 'chat-context-menu-danger' | 'chat-message-delete';

export interface ContextMenuItemData {
  id: string;
  label: string;
  icon?: ContextMenuIcon;
  disabled: boolean;
  hidden: boolean;
  checked: boolean;
  divided: boolean | 'up' | 'down' | 'self';
  customClass: ContextMenuItemClass;
}

export interface ContextMenuRequest {
  requestId: string;
  revision: number;
  x: number;
  y: number;
  minWidth: number;
  maxWidth: number;
  preserveIconWidth: boolean;
  items: ContextMenuItemData[];
}

export interface ContextMenuSnapshot extends ContextMenuRequest {
  generation: number;
  maxHeight: number;
}

export interface ContextMenuBinding {
  generation: number;
  revision: number;
}

export interface ContextMenuResult {
  requestId: string;
  itemId?: string;
  error?: string;
}

export interface ContextMenuHostApi {
  show: (request: ContextMenuRequest) => Promise<void>;
  update: (request: ContextMenuRequest) => Promise<void>;
  hide: (requestId: string) => Promise<void>;
  onResult: (listener: (result: ContextMenuResult) => void) => () => void;
}

export interface ContextMenuWindowApi {
  ready: () => Promise<ContextMenuSnapshot | null>;
  layout: (
    binding: ContextMenuBinding,
    size: { width: number; height: number },
  ) => Promise<void>;
  select: (binding: ContextMenuBinding, itemId: string) => Promise<void>;
  dismiss: (binding: ContextMenuBinding) => Promise<void>;
  onSnapshot: (
    listener: (snapshot: ContextMenuSnapshot | null) => void,
  ) => () => void;
}

/** 只接受有界普通对象，不允许跨窗口传函数、HTML 或业务凭据。 */
const objectValue = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('菜单参数无效');
  return value as Record<string, unknown>;
};

/** 校验菜单标识，拒绝过长或空的请求编号。 */
export const parseContextMenuId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[\w-]{1,80}$/.test(value))
    throw new Error('菜单标识无效');
  return value;
};

/** 校验有限布局数值，避免无效坐标或尺寸进入原生窗口。 */
export const parseContextMenuNumber = (
  value: unknown,
  min: number,
  max: number,
): number => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error('菜单位置或尺寸无效');
  return value;
};

/** 严格检查布尔状态，不把畸形参数转成已启用操作。 */
const booleanValue = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('菜单状态无效');
  return value;
};

/** 将 IPC 参数投影为展示字段，丢弃来源传入的额外能力。 */
export const parseContextMenuRequest = (value: unknown): ContextMenuRequest => {
  const input = objectValue(value);
  if (!Array.isArray(input.items) || input.items.length > 50)
    throw new Error('菜单条目无效');
  const ids = new Set<string>();
  const items = input.items.map((value: unknown): ContextMenuItemData => {
    const item = objectValue(value);
    const id = parseContextMenuId(item.id);
    if (ids.has(id)) throw new Error('菜单条目标识重复');
    ids.add(id);
    if (typeof item.label !== 'string' || item.label.length > 200)
      throw new Error('菜单文字无效');
    const icon = contextMenuIcons.find((name) => name === item.icon);
    if (item.icon !== undefined && !icon) throw new Error('菜单图标无效');
    let customClass: ContextMenuItemClass;
    switch (item.customClass) {
      case '':
      case 'chat-context-menu-danger':
      case 'chat-message-delete':
        customClass = item.customClass;
        break;
      default:
        throw new Error('菜单样式无效');
    }
    let divided: ContextMenuItemData['divided'];
    switch (item.divided) {
      case true:
      case false:
      case 'up':
      case 'down':
      case 'self':
        divided = item.divided;
        break;
      default:
        throw new Error('菜单分隔线无效');
    }
    return {
      id,
      label: item.label,
      icon,
      customClass,
      divided,
      disabled: booleanValue(item.disabled),
      hidden: booleanValue(item.hidden),
      checked: booleanValue(item.checked),
    };
  });
  const minWidth = parseContextMenuNumber(input.minWidth, 80, 640);
  const revision = parseContextMenuNumber(
    input.revision,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (!Number.isSafeInteger(revision)) throw new Error('菜单版本无效');
  return {
    requestId: parseContextMenuId(input.requestId),
    revision,
    x: parseContextMenuNumber(input.x, -640, 100000),
    y: parseContextMenuNumber(input.y, -640, 100000),
    minWidth,
    maxWidth: parseContextMenuNumber(input.maxWidth, minWidth, 640),
    preserveIconWidth: booleanValue(input.preserveIconWidth),
    items,
  };
};

/** 子窗口回报必须对应同一显示代次与内容版本。 */
export const parseContextMenuBinding = (value: unknown): ContextMenuBinding => {
  const input = objectValue(value);
  const generation = parseContextMenuNumber(
    input.generation,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const revision = parseContextMenuNumber(
    input.revision,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(revision))
    throw new Error('菜单版本无效');
  return { generation, revision };
};

/** 允许越过来源窗口边缘，但保持阴影及菜单在当前显示器工作区内。 */
export const positionContextMenu = (
  anchor: { x: number; y: number },
  area: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number; width: number; height: number } => {
  const width = Math.min(Math.ceil(size.width), area.width);
  const height = Math.min(Math.ceil(size.height), area.height);
  return {
    x: Math.round(
      Math.max(area.x, Math.min(anchor.x, area.x + area.width - width)),
    ),
    y: Math.round(
      Math.max(area.y, Math.min(anchor.y, area.y + area.height - height)),
    ),
    width,
    height,
  };
};
