import { useEffect, useRef } from 'react'

// ========== 中央气象台 NMC 全国雷达拼图（绕开 SenseMap SDK，直接用 AMap.ImageLayer 叠加） ==========
// 数据源：image.nmc.cn 每 6 分钟生成一帧全国雷达拼图；URL 时间戳为 UTC 时间（北京-8h）向下取整到 6 分钟刻度
const NMC_IMAGE_URL_TEMPLATE =
  'https://image.nmc.cn/product/{YYYY}/{MM}/{DD}/RDCP/medium/SEVP_AOC_RDCP_SLDAS3_ECREF_ACHN_L88_PI_{YYYYMMDDHHmm}00000.PNG'
const NMC_FRAME_INTERVAL_MS = 6 * 60 * 1000
/** 探测最新可用帧：从当前 UTC 帧向前最多回退 3 帧（每帧减 6 分钟） */
const NMC_MAX_RETRY_FRAMES = 3
/** 全国拼图覆盖范围：经度 73~136，纬度 17~54 */
const NMC_BOUNDS: [[number, number], [number, number]] = [
  [73, 17],
  [136, 54]
]
const NMC_Z_INDEX = 8
/** NMC 原图尺寸（宽×高），离屏透明化处理时保持原尺寸绘制 */
const NMC_IMAGE_SIZE: [number, number] = [825, 739]
/** 主判定（硬透明）：低饱和 + 高亮即透明。min(r,g,b) > NMC_LOW_SAT_MIN 且饱和度 (max-min) < NMC_LOW_SAT_SPREAD 的灰白/浅灰底纹 alpha 置 0 */
const NMC_LOW_SAT_MIN = 195
const NMC_LOW_SAT_SPREAD = 25
/** 软过渡带：min > NMC_SOFT_MIN 且饱和度 < NMC_SOFT_SPREAD 时按亮度线性插值 alpha（luma 255→0、luma 200→约 55），柔和羽化边缘避免突兀 */
const NMC_SOFT_MIN = 180
const NMC_SOFT_SPREAD = 35
/** 气象图例裁剪区（x0,y0,x1,y1，可调）：NMC 拼图左上角自带垂直彩色渐变条+刻度文字，透明化后会被当回波保留，整块裁掉 alpha=0 */
const NMC_LEGEND_RECT: [number, number, number, number] = [80, 80, 315, 235]

export interface RadarMapHandle {
  add: (layer: unknown | unknown[]) => void
  remove: (layer: unknown | unknown[]) => void
}

export type RadarStatus =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

interface SenseMapRadarLayerProps {
  map: RadarMapHandle | null
  enabled: boolean
  opacity: number
  onStatusChange?: (status: RadarStatus) => void
}

interface RadarImageLayerHandle {
  setImageUrl: (url: string) => void
  setOpacity: (opacity: number) => void
  remove: () => void
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 向下取整到 6 分钟刻度 */
function floorTo6Min(date: Date): Date {
  const ms = 6 * 60 * 1000
  return new Date(Math.floor(date.getTime() / ms) * ms)
}

/** 格式化 UTC 时间戳 YYYYMMDDHHmm */
function formatUtcStamp(date: Date): string {
  return (
    String(date.getUTCFullYear()) +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes())
  )
}

function buildUrl(date: Date): string {
  return NMC_IMAGE_URL_TEMPLATE
    .replace('{YYYY}', String(date.getUTCFullYear()))
    .replace('{MM}', pad2(date.getUTCMonth() + 1))
    .replace('{DD}', pad2(date.getUTCDate()))
    .replace('{YYYYMMDDHHmm}', formatUtcStamp(date))
}

/** 用 Image() 预加载探测 URL 是否可用 */
function probeUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

/** 加载图片并返回 HTMLImageElement（供离屏透明化管线使用） */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败: ${url}`))
    img.src = url
  })
}

/**
 * 白底透明化管线：Image() 加载 PNG → 离屏 canvas（保持原尺寸）→ getImageData 遍历像素，
 * 主判定（硬透明）：低饱和 + 高亮（min>NMC_LOW_SAT_MIN 且 max-min<NMC_LOW_SAT_SPREAD）的灰白/浅灰底纹 alpha 置 0；
 * 软过渡带：min>NMC_SOFT_MIN 且饱和度<NMC_SOFT_SPREAD 的浅灰像素按亮度线性插值 alpha（luma 255→0、luma 200→约 55），羽化边缘。
 * 彩色回波（蓝/绿/黄/红等，饱和度显著高于阈值）不在判定内，完整保留 → toDataURL 得到 data URL。
 * 容错：任一环节失败或 data URL 为空时回退返回原始 URL，保证至少能显示。
 */
async function transparentizeRadarUrl(rawUrl: string): Promise<string> {
  try {
    const img = await loadImage(rawUrl)
    const [width, height] = NMC_IMAGE_SIZE
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return rawUrl

    ctx.drawImage(img, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      // 图例区域裁剪：落在 NMC_LEGEND_RECT 矩形内（左上角气象图例，无论是否彩色）→ alpha 直接置 0
      const px = (i / 4) % width
      const py = Math.floor(i / 4 / width)
      if (px >= NMC_LEGEND_RECT[0] && px <= NMC_LEGEND_RECT[2] && py >= NMC_LEGEND_RECT[1] && py <= NMC_LEGEND_RECT[3]) {
        data[i + 3] = 0
        continue
      }
      const minC = Math.min(r, g, b)
      const maxC = Math.max(r, g, b)
      const saturation = maxC - minC
      // 主判定（硬透明）：低饱和 + 高亮灰白/浅灰底纹（含灰色省界/地理底纹）→ alpha 置 0
      if (minC > NMC_LOW_SAT_MIN && saturation < NMC_LOW_SAT_SPREAD) {
        data[i + 3] = 0
        continue
      }
      // 软过渡带：略低亮度/略高饱和的浅灰像素按亮度线性插值 alpha（luma 255→0、luma 200→约 55），柔和羽化边缘
      if (minC > NMC_SOFT_MIN && saturation < NMC_SOFT_SPREAD) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const softAlpha = Math.max(0, Math.min(255, Math.round(255 - luma)))
        if (softAlpha < data[i + 3]) data[i + 3] = softAlpha
      }
    }
    ctx.putImageData(imageData, 0, 0)

    const dataUrl = canvas.toDataURL('image/png')
    if (!dataUrl || dataUrl.length === 0) return rawUrl
    return dataUrl
  } catch (e) {
    console.warn('SenseMapRadarLayer: 雷达图白底透明化处理失败，回退原始图片', e)
    return rawUrl
  }
}

/** 从当前 UTC 帧向前最多回退 3 帧，返回第一个可加载的 URL；全失败返回 null */
async function findLatestFrameUrl(): Promise<string | null> {
  const now = floorTo6Min(new Date())
  for (let i = 0; i <= NMC_MAX_RETRY_FRAMES; i++) {
    const frame = new Date(now.getTime() - i * NMC_FRAME_INTERVAL_MS)
    const url = buildUrl(frame)
    try {
      if (await probeUrl(url)) return url
    } catch {
      // 单帧探测异常，继续回退探测前一帧
    }
  }
  return null
}

/**
 * NMC 全国雷达拼图图层（SenseMapRadarLayer 保留组件名与 props，内部数据源切换为中央气象台）。
 * - 帧图经白底透明化后写入 AMap.ImageLayer，避免不透明白底冲淡暗色全息底图，只保留彩色回波；
 * - enabled 控制图层开关；opacity 实时调节透明度（ImageLayer.setOpacity）；
 * - 每 6 分钟自动探测最新可用帧并 setImageUrl 刷新；
 * - 探测失败通过 onStatusChange 上报 error，不虚构成功。
 */
function SenseMapRadarLayer({
  map,
  enabled,
  opacity,
  onStatusChange
}: SenseMapRadarLayerProps): null {
  const layerRef = useRef<RadarImageLayerHandle | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mapRef = useRef<RadarMapHandle | null>(null)

  useEffect(() => {
    if (!map) return

    // enabled 关闭：移除图层、清定时器
    if (!enabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (layerRef.current) {
        try {
          layerRef.current.remove()
        } catch (e) {
          console.warn('SenseMapRadarLayer: 移除雷达图层失败', e)
        }
        layerRef.current = null
      }
      mapRef.current = null
      onStatusChange?.({ phase: 'idle' })
      return
    }

    mapRef.current = map
    let cancelled = false

    const getAmap = (): any => (window as any).AMap as any

    const ensureLayer = (url: string): void => {
      const AMap = getAmap()
      const handle = layerRef.current
      if (handle) {
        handle.setImageUrl(url)
        return
      }
      if (!AMap?.ImageLayer || !AMap?.Bounds || !mapRef.current) {
        throw new Error('AMap.ImageLayer 不可用')
      }
      const layer = new AMap.ImageLayer({
        bounds: new AMap.Bounds(NMC_BOUNDS[0], NMC_BOUNDS[1]),
        url,
        opacity,
        zIndex: NMC_Z_INDEX
      })
      mapRef.current.add(layer)
      layerRef.current = {
        setImageUrl: (u: string) => layer.setImageUrl(u),
        setOpacity: (o: number) => layer.setOpacity(o),
        remove: () => mapRef.current?.remove(layer)
      }
    }

    const refresh = async (): Promise<void> => {
      if (cancelled || !mapRef.current) return
      onStatusChange?.({ phase: 'loading' })
      const rawUrl = await findLatestFrameUrl()
      if (cancelled) return
      if (!rawUrl) {
        const msg = '雷达图获取失败：NMC 雷达服务暂无可用帧'
        console.error('SenseMapRadarLayer:', msg)
        onStatusChange?.({ phase: 'error', message: msg })
        return
      }
      try {
        // 异步透明化处理（不阻塞 UI），失败自动回退原始 URL
        const displayUrl = await transparentizeRadarUrl(rawUrl)
        if (cancelled) return
        ensureLayer(displayUrl)
        onStatusChange?.({ phase: 'ready' })
      } catch (e) {
        const msg = `雷达图获取失败：${String(e)}`
        console.error('SenseMapRadarLayer:', msg)
        onStatusChange?.({ phase: 'error', message: msg })
      }
    }

    void refresh()

    timerRef.current = setInterval(() => {
      void refresh()
    }, NMC_FRAME_INTERVAL_MS)

    return (): void => {
      cancelled = true
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (layerRef.current) {
        try {
          layerRef.current.remove()
        } catch (e) {
          console.warn('SenseMapRadarLayer: 移除雷达图层失败', e)
        }
        layerRef.current = null
      }
      mapRef.current = null
    }
  }, [map, enabled])

  useEffect(() => {
    if (!enabled) return
    if (!layerRef.current) return
    try {
      layerRef.current.setOpacity(opacity)
    } catch (e) {
      console.warn('SenseMapRadarLayer: 调节透明度失败', e)
    }
  }, [opacity, enabled])

  return null
}

export default SenseMapRadarLayer
