interface NearbyPOI {
  id: string
  name: string
  type: string
  address: string
  distance: number
  location: [number, number]
  tel?: string
}

import React, { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import * as THREE from 'three'
import SenseMapRadarLayer from './components/SenseMapRadarLayer'
import type { HoloMapBridge } from '../preload'
import { createPlannedRouteResult } from '../protocol'

declare global {
  interface Window { holoMap?: HoloMapBridge }
}

type HoloMapConfig = { amapJsApiKey: string; amapSecurityCode: string }

// 贾维斯全息极客青蓝主题
const JARVIS_THEME = {
  primary: '#00f0ff',
  accent: '#00d0ff',
  glow: 'rgba(0, 240, 255, 0.45)',
  border: 'rgba(0, 240, 255, 0.35)',
  bg: 'rgba(2, 6, 16, 0.9)'
}

interface GeolocationResult {
  position?: {
    getLng: () => number
    getLat: () => number
  }
  formattedAddress?: string
  city?: string
  district?: string
  adcode?: string
  message?: string
}

interface GeolocationInstance {
  getCurrentPosition: (callback: (status: string, result: GeolocationResult) => void) => void
}

interface AMapCustomCoords {
  lngLatToCoord: (lnglat: [number, number]) => [number, number]
  setCenter: (lnglat: [number, number]) => void
  getCameraParams: () => {
    near: number
    far: number
    fov: number
    up: [number, number, number]
    lookAt: [number, number, number]
    position: [number, number, number]
  }
}

interface AMapInstance {
  setZoomAndCenter: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void
  setPitch: (pitch: number) => void
  setRotation: (rotation: number) => void
  getPitch: () => number
  getRotation: () => number
  getZoom: () => number
  setZoom: (zoom: number) => void
  panBy: (x: number, y: number) => void
  getCenter: () => { getLng: () => number; getLat: () => number }
  panTo: (position: [number, number]) => void
  setCenter?: (position: [number, number]) => void
  on: (event: string, handler: (e?: any) => void) => void
  off: (event: string, handler: (e?: any) => void) => void
  add: (layer: unknown | unknown[]) => void
  remove: (layer: unknown | unknown[]) => void
  setFitView: (overlays?: unknown[], immediately?: boolean, avoid?: number[]) => void
  setDefaultCursor: (cursor?: string) => void
  setMapStyle: (style: string) => void
  render: () => void
  destroy: () => void
  customCoords: AMapCustomCoords
}

interface BuildingLayerInstance {
  setOpacity: (opacity: number) => void
  setZooms: (zooms: [number, number]) => void
  show?: () => void
  hide?: () => void
  setStyle?: (styleOpts: any) => void
}

interface AMapSDK {
  plugin?: (names: string | string[], callback: () => void) => void
  GeometryUtil?: any
  Map: new (
    container: HTMLElement,
    options: {
      viewMode: string
      pitch?: number
      rotation?: number
      zoom?: number
      center?: [number, number]
      mapStyle?: string
      features?: string[]
      showBuildingBlock?: boolean
      showLabel?: boolean
      skyColor?: string
      wallColor?: string | number[]
      roofColor?: string | number[]
      buildingAnimation?: boolean
    }
  ) => AMapInstance
  Buildings?: new (options?: {
    zooms?: [number, number]
    zIndex?: number
    heightFactor?: number
    opacity?: number
    wallColor?: string | number[]
    roofColor?: string | number[]
  }) => BuildingLayerInstance
  Geolocation?: new (options?: {
    enableHighAccuracy?: boolean
    timeout?: number
    maximumAge?: number
    needAddress?: boolean
    extensions?: string
  }) => GeolocationInstance
  GLCustomLayer?: new (options: {
    zIndex?: number
    init: (gl: WebGLRenderingContext) => void
    render: () => void
  }) => unknown
  InfoWindow?: any
  Marker: new (options: {
    position: [number, number]
    content?: string | HTMLElement
    offset?: any
    zIndex?: number
  }) => any
  Polyline: new (options: {
    path: any[]
    isOutline?: boolean
    outlineColor?: string
    borderWeight?: number
    strokeColor?: string
    strokeOpacity?: number
    strokeWeight?: number
    strokeStyle?: string
    strokeDasharray?: number[]
    lineJoin?: string
    lineCap?: string
    strokeJoin?: string
    strokeCap?: string
    zIndex?: number
  }) => any
  Pixel: new (x: number, y: number) => any
  Driving?: new (options?: any) => any
  DrivingPolicy?: any
  Walking?: new (options?: any) => any
  Riding?: new (options?: any) => any
  AutoComplete?: new (options?: any) => any
  PlaceSearch?: new (options?: any) => any
  Geocoder?: new (options?: any) => any
}

interface LandmarkPoint {
  x: number
  y: number
  z: number
}

function App(): React.JSX.Element {
  const [mapConfig, setMapConfig] = useState<HoloMapConfig | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<AMapInstance | null>(null)
  const [mapReady, setMapReady] = useState<AMapInstance | null>(null)
  // ========== 心知天气 SenseMap 雷达图层状态（开关 + 透明度 + 加载诊断） ==========
  const [radarEnabled, setRadarEnabled] = useState<boolean>(false)
  const [radarOpacity, setRadarOpacity] = useState<number>(0.8)
  const [radarStatus, setRadarStatus] = useState<string>('待机')
  const aMapSDKRef = useRef<AMapSDK | null>(null)
  const userCoordsRef = useRef<[number, number] | null>(null)
  const userCityRef = useRef<string>('')
  const [locationResolved, setLocationResolved] = useState(false)

  const rightPointerPrevRef = useRef<{ x: number; y: number } | null>(null)
  const leftDualCenterPrevRef = useRef<{ x: number; y: number } | null>(null)
  const rightHandLastZoomTickRef = useRef<number>(0)


  // 状态显示
  const [diagStatus, setDiagStatus] = useState<string>('正在构建 JARVIS 全息全景地图系统...')
  const [currentAddress, setCurrentAddress] = useState<string>('等待设备定位')
  const [fps, setFps] = useState<number>(60)
  const [, setGestureStatus] = useState<string>('地图手势控制由 Jarvis 统一管理')

  // 地图样式模式：'holo'(贾维斯暗夜全息) | 'standard'(高德软件官方标准浅色)
  const [mapTheme, setMapTheme] = useState<'holo' | 'standard'>('holo')
  // 是否开启类似 Zoom Earth 的风速粒子与色彩场流向层
  const buildingLayerRef = useRef<any>(null)

  // ========== 路线规划相关状态 ==========
    // ========== 附近商家 / POI 检索状态 ==========
  const [nearbyPOIs, setNearbyPOIs] = useState<NearbyPOI[]>([])
  const [isNearbyPanelOpen, setIsNearbyPanelOpen] = useState<boolean>(false)
  const [nearbyCategory, setNearbyCategory] = useState<string>('美食')
  // 附近商家检索基准点：'current' 当前定位 / 'destination' 导航目的地
  const [nearbyCenter, setNearbyCenter] = useState<'current' | 'destination'>('current')
  const [nearbyLoading, setNearbyLoading] = useState<boolean>(false)
  const nearbyMarkersRef = useRef<any[]>([])
  const infoWindowRef = useRef<any>(null)

  // ========== 天气实况与雨雪特效状态 ==========
  const [weatherInfo, setWeatherInfo] = useState<{
    weather: string
    temperature: string
    winddirection: string
    windpower: string
    humidity: string
    city: string
  } | null>(null)
  const [weatherFx, setWeatherFx] = useState<'rain' | 'snow' | 'none'>('none')
  // 特效模式：'auto' 跟随真实天气自动启停 / 'rain' 强制雨 / 'snow' 强制雪（点击天气角标循环切换）
  const [weatherFxMode, setWeatherFxMode] = useState<'auto' | 'rain' | 'snow'>('auto')
  const weatherFxModeRef = useRef<'auto' | 'rain' | 'snow'>('auto')
  // 天气实况拉取状态：防止重复触发 / 失败后仅自动重试一次
  const weatherTriggeredRef = useRef<boolean>(false)
  const weatherRetriedRef = useRef<boolean>(false)

  // 东南西北方位罗盘：跟随地图 rotation 旋转，点击回正正北
  const [compassRotation, setCompassRotation] = useState<number>(-15)

  const [isRoutePanelOpen, setIsRoutePanelOpen] = useState<boolean>(true)
  const [travelMode, setTravelMode] = useState<'drive' | 'ride' | 'walk'>('drive')
  const [drivePolicy, setDrivePolicy] = useState<number>(0) // 0: 推荐/最快, 4: 躲避拥堵, 1: 费用最低, 2: 距离最短
  const [startPointName, setStartPointName] = useState<string>('我的位置 (当前定位)')
  const [startPointCoords, setStartPointCoords] = useState<[number, number] | null>(null)
  const [endPointName, setEndPointName] = useState<string>('')
  const [endPointCoords, setEndPointCoords] = useState<[number, number] | null>(null)

  // 地图点选状态: 'start' | 'end' | null
  const [pickingTarget, setPickingTarget] = useState<'start' | 'end' | null>(null)
  const pickingTargetRef = useRef<'start' | 'end' | null>(null)
  pickingTargetRef.current = pickingTarget

  // 联想下拉列表
  const [suggestions, setSuggestions] = useState<
    Array<{ name: string; address: string; district: string; location?: [number, number] }>
  >([])
  const [activeSuggestionField, setActiveSuggestionField] = useState<'start' | 'end' | null>(null)
  const searchDebounceRef = useRef<number | null>(null)

  // 路线覆盖物与规划结果
  const routePolylinesRef = useRef<any[]>([])
  const startMarkerRef = useRef<any>(null)
  const endMarkerRef = useRef<any>(null)
  const routePathPointsRef = useRef<[number, number][]>([])

  const [isRouting, setIsRouting] = useState<boolean>(false)
  const [isNavigating, setIsNavigating] = useState<boolean>(false)
  const [routeInfo, setRouteInfo] = useState<{
    distanceText: string
    timeText: string
    modeText: string
  } | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeCandidates, setRouteCandidates] = useState<Array<{ name: string; address: string }>>([])
  const [routeCommandNotice, setRouteCommandNotice] = useState<string>('')
  const [routeCandidateMode, setRouteCandidateMode] = useState<'drive' | 'ride' | 'walk'>('drive')
  const [mapInitializationError, setMapInitializationError] = useState('')
  const mapCommandHandlerRef = useRef<((command: import('../protocol').MapCommandEnvelope) => void) | undefined>(undefined)

  useEffect(() => {
    if (!window.holoMap) {
      setDiagStatus('地图模块未连接到贾维斯主进程')
      return
    }
    void window.holoMap.getConfig().then(setMapConfig).catch((error) => {
      const message = `读取地图配置失败：${String(error)}`
      setMapInitializationError(message)
      setDiagStatus(message)
    })
  }, [])

  useEffect(() => {
    let mapInstance: AMapInstance | null = null
    let animationFrameId = 0
    let frameCount = 0
    let lastFpsUpdate = performance.now()

    if (!mapConfig) return
    if (!mapConfig.amapJsApiKey.trim() || !mapConfig.amapSecurityCode.trim()) {
      const message = '请在贾维斯设置中填写高德地图 JS API Key 和安全密钥'
      setMapInitializationError(message)
      setDiagStatus(message)
      return
    }

    Reflect.set(window, '_AMapSecurityConfig', {
      securityJsCode: mapConfig.amapSecurityCode
    })

    AMapLoader.load({
      key: mapConfig.amapJsApiKey,
      version: '2.0',
      plugins: [
        'AMap.ControlBar',
        'AMap.Buildings',
        'AMap.Geolocation',
        'AMap.Driving',
        'AMap.Walking',
        'AMap.Riding',
        'AMap.AutoComplete',
        'AMap.PlaceSearch',
        'AMap.Geocoder',
        'AMap.Weather'
      ]
    })
      .then((loadedAMap: unknown) => {
        const AMap = loadedAMap as AMapSDK
        aMapSDKRef.current = AMap
        if (!mapContainerRef.current) return

        setDiagStatus('正在初始化地图并获取设备位置...')

        // Start at a neutral overview until the device grants a real location.
        mapInstance = new AMap.Map(mapContainerRef.current, {
          viewMode: '3D',
          pitch: 58,
          rotation: -15,
          zoom: 3,
          center: [0, 0],
          mapStyle: 'amap://styles/dark',
          features: ['bg', 'road', 'point'],
          showBuildingBlock: false,
          showLabel: true,
          skyColor: '#01050c',
          buildingAnimation: false
        })

        mapInstanceRef.current = mapInstance
        setMapReady(mapInstance)

        // 绑定地图点击事件（用于拾取起点与终点）
        mapInstance.on('click', (e: any) => {
          if (!pickingTargetRef.current) return
          const target = pickingTargetRef.current
          const lng = e.lnglat.getLng()
          const lat = e.lnglat.getLat()
          const coords: [number, number] = [lng, lat]

          // 逆地理编码获取点位中文名称
          if (AMap.Geocoder) {
            const geocoder = new AMap.Geocoder({ city: '全国' })
            geocoder.getAddress(coords, (status: string, result: any) => {
              let addr = `${lng.toFixed(5)}, ${lat.toFixed(5)}`
              if (status === 'complete' && result?.regeocode?.formattedAddress) {
                addr = result.regeocode.formattedAddress
              }
              if (target === 'start') {
                setStartPointName(addr)
                setStartPointCoords(coords)
              } else {
                setEndPointName(addr)
                setEndPointCoords(coords)
              }
              setPickingTarget(null)
            })
          } else {
            if (target === 'start') {
              setStartPointName(`坐标点 [${lng.toFixed(4)}, ${lat.toFixed(4)}]`)
              setStartPointCoords(coords)
            } else {
              setEndPointName(`坐标点 [${lng.toFixed(4)}, ${lat.toFixed(4)}]`)
              setEndPointCoords(coords)
            }
            setPickingTarget(null)
          }
        })

        // (2) 配置真实高德 AMap.Buildings 3D 建筑体块：极致克制深邃暗蓝立面 + 通透暗青顶面，杜绝刺眼亮斑
        if (AMap.Buildings) {
          try {
            const buildingLayer = new AMap.Buildings({
              zIndex: 10,
              heightFactor: 1.0,
              opacity: 0.85,
              wallColor: 'rgba(0, 16, 36, 0.45)',
              roofColor: 'rgba(0, 38, 75, 0.55)'
            })
            mapInstance.add(buildingLayer)
            buildingLayerRef.current = buildingLayer
          } catch (e) {
            console.warn('高德原生 3D Buildings 初始化失败:', e)
          }
        }

        // (3) 初始化 Three.js WebGL 全息发光图层
        const customCoords = mapInstance.customCoords
        if (AMap.GLCustomLayer && customCoords) {
          let scene: THREE.Scene
          let camera: THREE.PerspectiveCamera
          let renderer: THREE.WebGLRenderer
          let ringGroup: THREE.Group

          try {
            const holoLayer = new AMap.GLCustomLayer({
              zIndex: 20,
              init: (gl: WebGLRenderingContext): void => {
                renderer = new THREE.WebGLRenderer({
                  context: gl
                })
                renderer.autoClear = false

                scene = new THREE.Scene()
                camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 10000)

                ringGroup = new THREE.Group()
                scene.add(ringGroup)

                customCoords.setCenter(userCoordsRef.current ?? [0, 0])

                // 贾维斯用户定位全息微光圈（干净不闪烁）
                const coreRingGeo = new THREE.RingGeometry(10, 13, 64)
                const coreRingMat = new THREE.MeshBasicMaterial({
                  color: 0x00f0ff,
                  side: THREE.DoubleSide,
                  transparent: true,
                  opacity: 0.85
                })
                const coreRingMesh = new THREE.Mesh(coreRingGeo, coreRingMat)
                coreRingMesh.rotation.x = -Math.PI / 2
                ringGroup.add(coreRingMesh)

                const outerHaloGeo = new THREE.RingGeometry(18, 24, 64)
                const outerHaloMat = new THREE.MeshBasicMaterial({
                  color: 0x00a0ff,
                  side: THREE.DoubleSide,
                  transparent: true,
                  opacity: 0.35
                })
                const outerHaloMesh = new THREE.Mesh(outerHaloGeo, outerHaloMat)
                outerHaloMesh.rotation.x = -Math.PI / 2
                ringGroup.add(outerHaloMesh)

                const centerGeo = new THREE.CircleGeometry(5, 32)
                const centerMat = new THREE.MeshBasicMaterial({
                  color: 0xffffff,
                  side: THREE.DoubleSide,
                  transparent: true,
                  opacity: 0.95
                })
                const centerMesh = new THREE.Mesh(centerGeo, centerMat)
                centerMesh.rotation.x = -Math.PI / 2
                centerMesh.position.y = 0.5
                ringGroup.add(centerMesh)
              },
              render: (): void => {
                if (!customCoords || !ringGroup || !renderer) return

                const currentCoords = userCoordsRef.current ?? [0, 0]
                customCoords.setCenter(currentCoords)
                const [relX, relY] = customCoords.lngLatToCoord(currentCoords)
                ringGroup.position.set(relX, relY, 0)

                // 优雅缓慢呼吸，极其轻微克制
                const time = performance.now() * 0.0012
                const scale = 1.0 + 0.08 * Math.sin(time)
                ringGroup.scale.set(scale, scale, 1.0)

                const { near, far, fov, up, lookAt, position } = customCoords.getCameraParams()
                ;(camera as THREE.PerspectiveCamera).near = near
                ;(camera as THREE.PerspectiveCamera).far = far
                ;(camera as THREE.PerspectiveCamera).fov = fov
                ;(camera as THREE.PerspectiveCamera).position.set(...position)
                ;(camera as THREE.PerspectiveCamera).up.set(...up)
                ;(camera as THREE.PerspectiveCamera).lookAt(...lookAt)
                ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()

                renderer.state.reset()
                renderer.render(scene, camera)
              }
            })

            mapInstance.add(holoLayer)
          } catch (err) {
            console.error('Three.js CustomLayer 渲染失败:', err)
          }
        }

        // Use only a real device location; never substitute a fixed city or home coordinate.
        const applyUserLocation = (coords: [number, number], addr?: string): void => {
          userCoordsRef.current = coords
          setLocationResolved(true)
          const resolvedAddress = addr || '当前精准定位位置'
          console.info(`[定位] 真实定位成功: [${coords[0]}, ${coords[1]}] -> ${resolvedAddress}`)
          setCurrentAddress(resolvedAddress)
          setStartPointName(resolvedAddress)
          setStartPointCoords(coords)

          if (mapInstance) {
            // 将地图中心平滑移动至真实定位坐标（地图初始以 fallback 创建，定位成功后以真实位置为基准中心）
            mapInstance.setZoomAndCenter(18, coords, false, 800)
          }
          setDiagStatus('已精确锚定当前位置: ' + resolvedAddress)
        }

        const locateWithBrowser = (): void => {
          if (!navigator.geolocation) {
            const message = '无法获取当前位置：系统未提供定位服务，请检查 Windows 定位权限'
            setLocationResolved(true)
            setDiagStatus(message)
            return
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude]
              applyUserLocation(coords)
            },
            () => {
              setLocationResolved(true)
              setDiagStatus('无法获取当前位置：请在 Windows 定位设置中允许 Jarvis 地图访问位置，然后重试')
            },
            { enableHighAccuracy: true, timeout: 12_000 }
          )
        }

        if (AMap.Geolocation) {
          const geolocation = new AMap.Geolocation({
            enableHighAccuracy: true,
            timeout: 10000,
            needAddress: true,
            extensions: 'all'
          })

          geolocation.getCurrentPosition((status: string, result: GeolocationResult) => {
            if (status === 'complete' && result.position) {
              const currentLng = result.position.getLng()
              const currentLat = result.position.getLat()
              applyUserLocation([currentLng, currentLat], result.formattedAddress)
              if (result.adcode) userCityRef.current = result.adcode
              else if (result.city) userCityRef.current = result.city
              else userCityRef.current = ''
              fetchWeather()
            } else {
              locateWithBrowser()
            }
          })
        } else locateWithBrowser()

        // (4.5) 挂载全息交通引导标志（红绿灯 / 分岔路箭头）
        try {
          addHoloTrafficSigns(AMap, mapInstance)
        } catch (e) {
          console.warn('全息交通标志挂载提示:', e)
        }

        // 地图 rotation 变化时同步方位罗盘
        mapInstance.on('rotate', () => {
          if (mapInstance) setCompassRotation(mapInstance.getRotation())
        })

        // (5) 驱动渲染循环计算实时 FPS
        const renderLoop = (): void => {
          frameCount++
          const now = performance.now()
          if (now - lastFpsUpdate >= 500) {
            setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdate)))
            frameCount = 0
            lastFpsUpdate = now
          }
          if (mapInstance) {
            mapInstance.render()
            // 兜底同步罗盘（手势旋转等场景不触发 rotate 事件时也能跟随）
            setCompassRotation(mapInstance.getRotation())
          }
          animationFrameId = requestAnimationFrame(renderLoop)
        }
        renderLoop()

      })
      .catch((e: unknown) => {
        console.error('AMAP LOAD ERROR:', e)
        const message = `高德地图 SDK 加载失败：${String(e)}`
        setMapInitializationError(message)
        setDiagStatus('❌ ' + message)
      })

    return (): void => {
      cancelAnimationFrame(animationFrameId)
      if (mapInstance) {
        mapInstance.destroy()
      }
    }
  }, [mapConfig])

  // 鼠标光标状态控制（地图选点时为十字准星）
  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setDefaultCursor(pickingTarget ? 'crosshair' : '')
    }
  }, [pickingTarget])

  // 按下 ESC 取消选点模式
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (pickingTargetRef.current) {
          setPickingTarget(null)
        }
        setActiveSuggestionField(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return (): void => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 处理手势与地图交互
  const handleHandsInteraction = (landmarksList: LandmarkPoint[][], handednesses: any[]): void => {
    const map = mapInstanceRef.current
    if (!map) return

    let rightHandIndex = -1
    let leftHandIndex = -1

    // 摄像头自适应左右手映射（支持单手智能兜底）
    landmarksList.forEach((_, idx) => {
      const handedness = handednesses[idx] && handednesses[idx][0]
      const label = handedness?.categoryName?.toLowerCase() || ''
      // MediaPipe 的 'Left' 对应镜头视觉镜像后的右手（对于用户而言是物理右手）
      if (label === 'left' || label === 'right') {
        if (label === 'left' && rightHandIndex === -1) {
          rightHandIndex = idx
        } else if (label === 'right' && leftHandIndex === -1) {
          leftHandIndex = idx
        } else if (rightHandIndex === -1) {
          rightHandIndex = idx
        } else if (leftHandIndex === -1) {
          leftHandIndex = idx
        }
      } else {
        if (rightHandIndex === -1) rightHandIndex = idx
        else if (leftHandIndex === -1) leftHandIndex = idx
      }
    })

    // 如果只检测到一只手，优先作为主控手（右手：负责平移、放大缩小）
    if (landmarksList.length === 1 && rightHandIndex === -1) {
      rightHandIndex = 0
    }

    // ========== 1. 右手手势处理 ==========
    if (rightHandIndex !== -1) {
      const rightLandmarks = landmarksList[rightHandIndex]
      const thumbTip = rightLandmarks[4]
      const indexTip = rightLandmarks[8]
      const middleTip = rightLandmarks[12]
      const ringTip = rightLandmarks[16]
      const pinkyTip = rightLandmarks[20]

      const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y)
      const isIndexExtended = indexTip.y < rightLandmarks[6].y
      const isMiddleExtended = middleTip.y < rightLandmarks[10].y
      const isRingExtended = ringTip.y < rightLandmarks[14].y
      const isPinkyExtended = pinkyTip.y < rightLandmarks[18].y

      const isPalmOpen = isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended
      const isPinching = pinchDist < 0.055

      const now = performance.now()
      if (now - rightHandLastZoomTickRef.current > 70) {
        if (isPinching) {
          map.setZoom(map.getZoom() - 0.2)
          setGestureStatus('右手捏合: 缩小视野')
          rightHandLastZoomTickRef.current = now
        } else if (isPalmOpen && pinchDist > 0.12) {
          map.setZoom(map.getZoom() + 0.2)
          setGestureStatus('右手撑开: 放大视野')
          rightHandLastZoomTickRef.current = now
        }
      }

      if (isIndexExtended && !isRingExtended && !isPinkyExtended && !isPinching) {
        const curX = indexTip.x
        const curY = indexTip.y

        if (rightPointerPrevRef.current) {
          const dx = (curX - rightPointerPrevRef.current.x) * 1100
          const dy = (curY - rightPointerPrevRef.current.y) * 1100
          if (Math.abs(dx) > 1.2 || Math.abs(dy) > 1.2) {
            map.panBy(-dx, dy)
            setGestureStatus('右手单指: 平移全息沙盘')
          }
        }
        rightPointerPrevRef.current = { x: curX, y: curY }
      } else {
        rightPointerPrevRef.current = null
      }
    } else {
      rightPointerPrevRef.current = null
    }

    // ========== 2. 左手手势处理 ==========
    if (leftHandIndex !== -1) {
      const leftLandmarks = landmarksList[leftHandIndex]
      const indexTip = leftLandmarks[8]
      const middleTip = leftLandmarks[12]
      const isIndexExtended = indexTip.y < leftLandmarks[6].y
      const isMiddleExtended = middleTip.y < leftLandmarks[10].y

      if (isIndexExtended && isMiddleExtended) {
        const centerX = (indexTip.x + middleTip.x) / 2
        const centerY = (indexTip.y + middleTip.y) / 2

        if (leftDualCenterPrevRef.current) {
          const dx = (centerX - leftDualCenterPrevRef.current.x) * 450
          const dy = (centerY - leftDualCenterPrevRef.current.y) * 260

          if (Math.abs(dx) > 0.6) {
            const newRot = map.getRotation() + dx
            map.setRotation(newRot)
          }

          if (Math.abs(dy) > 0.6) {
            const currentPitch = map.getPitch()
            const newPitch = Math.max(0, Math.min(80, currentPitch - dy))
            map.setPitch(newPitch)
          }

          setGestureStatus('左手双指: 旋转视角 / 仰角调节')
        }

        leftDualCenterPrevRef.current = { x: centerX, y: centerY }
      } else {
        leftDualCenterPrevRef.current = null
      }
    } else {
      leftDualCenterPrevRef.current = null
    }
  }

  // 回正到用户当前位置并近距离聚焦
  const handleRecenter = (): void => {
    if (mapInstanceRef.current && userCoordsRef.current) {
      mapInstanceRef.current.setZoomAndCenter(18, userCoordsRef.current, false, 800)
      mapInstanceRef.current.setPitch(58)
      mapInstanceRef.current.setRotation(-15)
    }
  }

  // 通过高德 AMap.Weather 插件获取当前城市实况天气，并据此启停雨雪特效
  const fetchWeather = (): void => {
    const AMap = aMapSDKRef.current
    if (!AMap || !AMap.plugin) {
      console.warn('天气获取跳过：AMap SDK 未就绪')
      return
    }
    if (!userCityRef.current) return
    weatherTriggeredRef.current = true
    AMap.plugin(['AMap.Weather'], () => {
      try {
        const weather = new (AMap as unknown as { Weather: new () => any }).Weather()
        weather.getLive(userCityRef.current, (err: any, data: any) => {
          if (err || !data || !data.lives || data.lives.length === 0) {
            console.warn('天气实况获取失败，稍后自动重试一次:', err || '无 lives 数据')
            setWeatherInfo(null)
            setWeatherFx('none')
            if (!weatherRetriedRef.current) {
              weatherRetriedRef.current = true
              setTimeout(fetchWeather, 3000)
            }
            return
          }
          weatherRetriedRef.current = false
          const live = data.lives[0]
          setWeatherInfo({
            weather: live.weather || '未知',
            temperature: String(live.temperature ?? '--'),
            winddirection: live.winddirection || '',
            windpower: live.windpower || '',
            humidity: live.humidity || '',
            city: live.city || userCityRef.current
          })
          const w = (live.weather || '') as string
          // 仅在自动模式下跟随真实天气启停；手动模式保持用户选择
          if (weatherFxModeRef.current === 'auto') {
            if (w.includes('雪')) setWeatherFx('snow')
            else if (w.includes('雨') || w.includes('雷')) setWeatherFx('rain')
            else setWeatherFx('none')
          }
        })
      } catch (e) {
        console.error('WEATHER FETCH ERROR:', e)
        setWeatherFx('none')
      }
    })
  }

  // ========== 全息交通引导标志（红绿灯 / 分岔路箭头） ==========
  const addHoloTrafficSigns = (AMap: AMapSDK, map: AMapInstance): void => {
    const base = userCoordsRef.current
    if (!base || !AMap.Marker || !AMap.Polyline) return
    const [blng, blat] = base

    // 主要路口模拟坐标：围绕当前定位，覆盖航海路 / 京广快速路等主干道交叉口
    const trafficSpots: [number, number][] = [
      [blng + 0.0016, blat + 0.0012],
      [blng - 0.0018, blat + 0.001],
      [blng + 0.0022, blat - 0.0011],
      [blng - 0.0015, blat - 0.0014],
      [blng + 0.003, blat + 0.0006],
      [blng - 0.0032, blat - 0.0008],
      [blng + 0.0004, blat + 0.0028],
      [blng - 0.0006, blat - 0.003],
      [blng + 0.0036, blat - 0.0022],
      [blng - 0.0038, blat + 0.0024],
      [blng + 0.0012, blat - 0.0034],
      [blng - 0.001, blat + 0.0036]
    ]

    // 红绿灯 Marker：全息青蓝边框小圆片 + 红黄绿三灯
    const createTrafficLightDom = (): HTMLElement => {
      const wrap = document.createElement('div')
      wrap.style.cssText =
        'width:22px;height:34px;background:rgba(2,10,20,0.88);border:1px solid rgba(0,240,255,0.45);' +
        'border-radius:6px;box-shadow:0 0 10px rgba(0,240,255,0.35), inset 0 0 6px rgba(0,240,255,0.12);' +
        'display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;padding:3px 0;box-sizing:border-box;'
      ;(['#ff3b30', '#ffd60a', '#30d158'] as const).forEach((c) => {
        const lamp = document.createElement('span')
        lamp.style.cssText = `width:8px;height:8px;border-radius:50%;background:${c};opacity:0.92;box-shadow:0 0 6px ${c};`
        wrap.appendChild(lamp)
      })
      return wrap
    }

    trafficSpots.forEach((pos) => {
      try {
        const marker = new AMap.Marker({
          position: pos,
          content: createTrafficLightDom(),
          offset: new AMap.Pixel(-11, -17),
          zIndex: 8
        })
        map.add(marker)
      } catch {
        // 单个标志失败不阻塞整体
      }
    })

    // 分岔路箭头 Marker：参考高德导航车道分叉样式，改造为全息青蓝发光版本
    const createForkDom = (): HTMLElement => {
      const wrap = document.createElement('div')
      wrap.style.cssText =
        'width:44px;height:30px;filter:drop-shadow(0 0 4px rgba(0,240,255,0.65));pointer-events:none;'
      wrap.innerHTML =
        `<svg width="44" height="30" viewBox="0 0 44 30" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        `<path d="M4 27 C 10 19, 14 13, 19 7" stroke="#00f0ff" stroke-width="2.2" stroke-linecap="round" fill="none"/>` +
        `<path d="M40 27 C 34 19, 30 13, 25 7" stroke="#00f0ff" stroke-width="2.2" stroke-linecap="round" fill="none"/>` +
        `<path d="M19 7 L 24 2 L 24 12 Z" fill="#00f0ff" opacity="0.9"/>` +
        `<path d="M25 7 L 20 2 L 20 12 Z" fill="#00f0ff" opacity="0.9"/>` +
        `<line x1="2" y1="28" x2="42" y2="28" stroke="rgba(0,240,255,0.5)" stroke-width="1"/>` +
        `</svg>`
      return wrap
    }

    const forkSpots: [number, number][] = [
      trafficSpots[8],
      trafficSpots[9],
      trafficSpots[10],
      trafficSpots[11],
      trafficSpots[4],
      trafficSpots[5]
    ]
    forkSpots.forEach((pos) => {
      try {
        const marker = new AMap.Marker({
          position: pos,
          content: createForkDom(),
          offset: new AMap.Pixel(-22, -15),
          zIndex: 8
        })
        map.add(marker)
      } catch {
        // ignore
      }
    })
  }

  // 切换【贾维斯全息暗夜】与【高德官方标准】地图样式
  const handleToggleMapTheme = (): void => {
    const map = mapInstanceRef.current
    if (!map) return

    if (mapTheme === 'holo') {
      // 切换为官方标准地图样式 (amap://styles/normal)
      map.setMapStyle('amap://styles/normal')
      setMapTheme('standard')
      // 隐藏自定义暗黑全息建筑
      if (buildingLayerRef.current) {
        try {
          if (typeof buildingLayerRef.current.hide === 'function') {
            buildingLayerRef.current.hide()
          } else {
            buildingLayerRef.current.setOpacity(0)
          }
        } catch {
          // ignore
        }
      }
    } else {
      // 切换回贾维斯科技暗夜样式 (amap://styles/dark)
      map.setMapStyle('amap://styles/dark')
      setMapTheme('holo')
      if (buildingLayerRef.current) {
        try {
          if (typeof buildingLayerRef.current.show === 'function') {
            buildingLayerRef.current.show()
          }
          buildingLayerRef.current.setOpacity(0.85)
        } catch {
          // ignore
        }
      }
    }
  }

  // ========== 路线规划业务方法 ==========

  // 清空地图上绘制的路线与标记
  const clearRouteOverlays = (): void => {
    const map = mapInstanceRef.current
    if (!map) return

    if (routePolylinesRef.current.length > 0) {
      routePolylinesRef.current.forEach((pl) => {
        try {
          map.remove(pl)
        } catch {
          // ignore
        }
      })
      routePolylinesRef.current = []
    }

    if (startMarkerRef.current) {
      try {
        map.remove(startMarkerRef.current)
      } catch {
        // ignore
      }
      startMarkerRef.current = null
    }

    if (endMarkerRef.current) {
      try {
        map.remove(endMarkerRef.current)
      } catch {
        // ignore
      }
      endMarkerRef.current = null
    }
  }

  // 完全清除路线与输入
  const handleClearRoute = (): void => {
    clearRouteOverlays()
    setIsNavigating(false)
    routePathPointsRef.current = []
    setRouteInfo(null)
    setRouteError(null)
    setEndPointName('')
    setEndPointCoords(null)
    setPickingTarget(null)
    setActiveSuggestionField(null)
    setSuggestions([])
  }

  // 快捷设置起点为当前定位
  const handleSetStartToCurrent = (): void => {
    if (!userCoordsRef.current) {
      setRouteError('尚未获取设备当前位置，请检查 Windows 定位权限')
      return
    }
    setStartPointName(currentAddress || '我的位置 (当前定位)')
    setStartPointCoords(userCoordsRef.current)
    setPickingTarget(null)
    setActiveSuggestionField(null)
    setSuggestions([])
  }

  // 对调起点与终点
    // 清除地图上的附近商家标记与气泡
  const clearNearbyMarkers = (): void => {
    const map = mapInstanceRef.current
    if (map && nearbyMarkersRef.current.length > 0) {
      nearbyMarkersRef.current.forEach((marker) => {
        try {
          map.remove(marker)
        } catch {
          // ignore
        }
      })
      nearbyMarkersRef.current = []
    }
    if (infoWindowRef.current) {
      try {
        infoWindowRef.current.close()
      } catch {
        // ignore
      }
    }
  }

  // 搜索附近商家 POI：始终以【当前所在精准定位初始点】为准，按关键词全城/周边检索，全部按由近及远排列
  // 附近商家检索：支持以当前定位或导航目的地为圆心
  const handleSearchNearby = (
    category: string = nearbyCategory,
    centerMode: 'current' | 'destination' = nearbyCenter,
    onComplete?: (error: Error | null, places?: NearbyPOI[]) => void
  ): void => {
    const AMap = aMapSDKRef.current
    const map = mapInstanceRef.current
    if (!AMap || !map) {
      onComplete?.(new Error('地图引擎正在启动'))
      return
    }

    setNearbyLoading(true)
    clearNearbyMarkers()

    // 基准点选择：优先以导航目的地为圆心，未设置目的地时回退到当前真实定位
    const useDest = centerMode === 'destination'
    if (useDest && !endPointCoords) {
      setNearbyCenter('current')
      setNearbyLoading(false)
      setDiagStatus('尚未设置导航目的地，已回退为当前定位搜索')
      onComplete?.(new Error('尚未设置导航目的地'))
      return
    }
    if (!useDest && !userCoordsRef.current) {
      setNearbyLoading(false)
      setDiagStatus('无法搜索附近地点：尚未获取设备当前位置，请检查定位权限')
      onComplete?.(new Error('无法获取当前位置，请检查 Windows 定位权限'))
      return
    }
    const searchCenter: [number, number] = useDest ? endPointCoords! : userCoordsRef.current!

    if (AMap.PlaceSearch) {
      const placeSearch = new AMap.PlaceSearch({
        pageSize: 25,
        pageIndex: 1,
        extensions: 'all',
        autoFitView: false
      })

      // 超时兜底：防止回调异常导致加载状态永远转圈
      const loadingTimer = window.setTimeout(() => {
        setNearbyLoading(false)
        setDiagStatus('搜索超时，请稍后重试')
        onComplete?.(new Error('附近地点搜索超时'))
      }, 15000)

      // 周边检索，半径取高德允许的最大值（50公里），不设距离上限，全部包容
      placeSearch.searchNearBy(
        category,
        searchCenter,
        50000,
        (status: string, result: any) => {
          window.clearTimeout(loadingTimer)
          setNearbyLoading(false)

          if (status === 'complete' && result && result.poiList && result.poiList.pois) {
            const rawPois: NearbyPOI[] = result.poiList.pois.map((poi: any) => {
              const poiLoc: [number, number] = [poi.location.lng, poi.location.lat]
              // 若接口未返回精准 distance，则计算与当前定位基准点的球面距离
              let dist = poi.distance ? Number(poi.distance) : 0
              if (dist <= 0 && AMap.GeometryUtil) {
                dist = Math.round(AMap.GeometryUtil.distance(searchCenter, poiLoc))
              }
              return {
                id: poi.id,
                name: poi.name,
                type: poi.type || category,
                address: poi.address || '暂无详细门牌地址',
                distance: dist,
                location: poiLoc,
                tel: poi.tel
              }
            })

            // 严格按照【距离由近及远】升序排列
            const sortedPois = rawPois.sort((a, b) => a.distance - b.distance)
            setNearbyPOIs(sortedPois)
            setDiagStatus(`已找到 ${sortedPois.length} 家「${category}」，按距离由近及远展示`)
            onComplete?.(null, sortedPois)

            // 在高德底图上打上发光全息标记
            const newMarkers: any[] = []
            sortedPois.forEach((poi, index) => {
              const markerContent = document.createElement('div')
              markerContent.style.display = 'flex'
              markerContent.style.flexDirection = 'column'
              markerContent.style.alignItems = 'center'
              markerContent.style.cursor = 'pointer'
              markerContent.innerHTML = `
                <div style="background: rgba(2, 14, 33, 0.9); border: 1px solid #00f0ff; color: #00f0ff; border-radius: 12px; padding: 2px 7px; font-size: 11px; font-weight: 700; box-shadow: 0 0 10px rgba(0,240,255,0.4); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
                  <span style="display:inline-block; width:14px; height:14px; line-height:14px; text-align:center; background:#00f0ff; color:#010915; border-radius:50%; font-size:10px;">${index + 1}</span>
                  <span>${poi.name.length > 8 ? poi.name.slice(0, 8) + '...' : poi.name}</span>
                </div>
                <div style="width: 2px; height: 8px; background: #00f0ff; box-shadow: 0 0 4px #00f0ff;"></div>
                <div style="width: 6px; height: 6px; border-radius: 50%; background: #00f0ff; box-shadow: 0 0 8px #00f0ff;"></div>
              `

              const marker = new AMap.Marker({
                position: poi.location,
                content: markerContent,
                offset: new AMap.Pixel(-20, -32),
                zIndex: 120
              })

              marker.on('click', () => {
                focusOnPOI(poi)
              })

              newMarkers.push(marker)
            })

            map.add(newMarkers)
            nearbyMarkersRef.current = newMarkers
          } else {
            setNearbyPOIs([])
            setDiagStatus('未找到符合条件的商家，请尝试更换分类')
            onComplete?.(null, [])
          }
        }
      )
    } else onComplete?.(new Error('高德地点搜索模块未就绪'))
  }

  // 聚焦到指定 POI 并显示全息气泡
  const focusOnPOI = (poi: NearbyPOI): void => {
    const AMap = aMapSDKRef.current
    const map = mapInstanceRef.current
    if (!AMap || !map) return

    map.panTo(poi.location)
    map.setZoom(16)

    if (!infoWindowRef.current) {
      infoWindowRef.current = new AMap.InfoWindow({
        isCustom: true,
        offset: new AMap.Pixel(0, -38)
      })
    }

    const infoContent = document.createElement('div')
    infoContent.style.background = 'rgba(2, 12, 28, 0.95)'
    infoContent.style.border = '1px solid #00f0ff'
    infoContent.style.borderRadius = '4px'
    infoContent.style.padding = '10px 14px'
    infoContent.style.boxShadow = '0 8px 24px rgba(0, 240, 255, 0.25)'
    infoContent.style.color = '#ffffff'
    infoContent.style.minWidth = '220px'
    infoContent.style.maxWidth = '280px'
    infoContent.style.fontFamily = 'system-ui, -apple-system, sans-serif'

    infoContent.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
        <span style="font-weight:700; font-size:13px; color:#00f0ff; letter-spacing:0.5px;">${poi.name}</span>
        <span id="close-info-win" style="cursor:pointer; color:#7899b5; font-size:13px; margin-left:8px;">✕</span>
      </div>
      <div style="font-size:11px; color:#9cbcd8; margin-bottom:4px; line-height:1.4;">📍 ${poi.address}</div>
      ${poi.distance ? `<div style="font-size:11px; color:#00ffaa; margin-bottom:4px;">📏 距离当前中心约 ${poi.distance > 1000 ? (poi.distance / 1000).toFixed(1) + ' km' : poi.distance + ' m'}</div>` : ''}
      ${poi.tel ? `<div style="font-size:11px; color:#6ec0cd; margin-bottom:8px;">📞 ${poi.tel}</div>` : ''}
      <div style="margin-top:8px; display:flex; gap:6px;">
        <button id="set-as-dest-btn" style="flex:1; background:rgba(0,240,255,0.18); border:1px solid #00f0ff; color:#00f0ff; border-radius:2px; padding:4px 8px; font-size:11px; font-weight:600; cursor:pointer;">
          🧭 设为导航终点
        </button>
      </div>
    `

    infoContent.querySelector('#close-info-win')?.addEventListener('click', () => {
      infoWindowRef.current?.close()
    })

    infoContent.querySelector('#set-as-dest-btn')?.addEventListener('click', () => {
      setEndPointName(poi.name)
      setEndPointCoords(poi.location)
      setIsRoutePanelOpen(true)
      infoWindowRef.current?.close()
    })

    infoWindowRef.current.setContent(infoContent)
    infoWindowRef.current.open(map, poi.location)
  }

  const handleSwapPoints = (): void => {
    const tempName = startPointName
    const tempCoords = startPointCoords
    setStartPointName(endPointName)
    setStartPointCoords(endPointCoords)
    setEndPointName(tempName)
    setEndPointCoords(tempCoords)
    setActiveSuggestionField(null)
    setSuggestions([])
  }

  // 输入关键字防抖联想搜索
  const handleKeywordChange = (field: 'start' | 'end', val: string): void => {
    if (field === 'start') {
      setStartPointName(val)
      setStartPointCoords(null)
    } else {
      setEndPointName(val)
      setEndPointCoords(null)
    }

    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current)
    }

    if (!val.trim()) {
      setSuggestions([])
      setActiveSuggestionField(null)
      return
    }

    searchDebounceRef.current = window.setTimeout(() => {
      const AMap = aMapSDKRef.current
      if (!AMap || !AMap.AutoComplete) return

      const autoComplete = new AMap.AutoComplete({ city: '全国' })
      autoComplete.search(val, (status: string, result: any) => {
        if (status === 'complete' && result && Array.isArray(result.tips)) {
          const list = result.tips
            .filter((tip: any) => tip.name && typeof tip.name === 'string')
            .slice(0, 5)
            .map((tip: any) => {
              let location: [number, number] | undefined = undefined
              if (tip.location) {
                if (typeof tip.location.getLng === 'function') {
                  location = [tip.location.getLng(), tip.location.getLat()]
                } else if (
                  typeof tip.location.lng === 'number' &&
                  typeof tip.location.lat === 'number'
                ) {
                  location = [tip.location.lng, tip.location.lat]
                }
              }
              return {
                name: tip.name,
                address: tip.address || tip.district || '',
                district: tip.district || '',
                location
              }
            })
          setSuggestions(list)
          setActiveSuggestionField(field)
        }
      })
    }, 250)
  }

  // 选中联想结果
  const handleSelectSuggestion = (field: 'start' | 'end', item: any): void => {
    if (item.location) {
      if (field === 'start') {
        setStartPointName(item.name)
        setStartPointCoords(item.location)
      } else {
        setEndPointName(item.name)
        setEndPointCoords(item.location)
      }
      setSuggestions([])
      setActiveSuggestionField(null)
    } else {
      // 若 tip 缺少经纬度，通过 PlaceSearch 查询精确点位
      const AMap = aMapSDKRef.current
      if (AMap && AMap.PlaceSearch) {
        const placeSearch = new AMap.PlaceSearch({ city: item.district || '全国' })
        placeSearch.search(item.name, (status: string, result: any) => {
          if (status === 'complete' && result?.poiList?.pois?.length > 0) {
            const poi = result.poiList.pois[0]
            const loc: [number, number] = [poi.location.lng, poi.location.lat]
            if (field === 'start') {
              setStartPointName(poi.name)
              setStartPointCoords(loc)
            } else {
              setEndPointName(poi.name)
              setEndPointCoords(loc)
            }
          } else {
            if (field === 'start') setStartPointName(item.name)
            else setEndPointName(item.name)
          }
          setSuggestions([])
          setActiveSuggestionField(null)
        })
      } else {
        if (field === 'start') setStartPointName(item.name)
        else setEndPointName(item.name)
        setSuggestions([])
        setActiveSuggestionField(null)
      }
    }
  }

  // 执行高德路线规划计算与渲染（支持即时传入新的出行模式或驾车策略）
  const handlePlanRoute = (
    overrideMode?: 'drive' | 'ride' | 'walk',
    overridePolicy?: number,
    onComplete?: (error: Error | null, result?: unknown) => void,
    points?: { origin: [number, number]; destination: [number, number]; originName: string; destinationName: string }
  ): void => {
    const AMap = aMapSDKRef.current
    const map = mapInstanceRef.current
    if (!AMap || !map) {
      setRouteError('地图引擎正在启动，请稍后重试')
      onComplete?.(new Error('地图引擎正在启动，请稍后重试'))
      return
    }

    const origin = points?.origin ?? startPointCoords ?? userCoordsRef.current
    if (!origin) {
      setRouteError('无法获取设备当前位置，请检查 Windows 定位权限')
      onComplete?.(new Error('无法获取设备当前位置，请检查 Windows 定位权限'))
      return
    }
    const routeDestination = points?.destination ?? endPointCoords
    if (!routeDestination) {
      setRouteError('请指定有效的目的地（输入搜索或地图选点）')
      onComplete?.(new Error('请先选择有效的路线目的地'))
      return
    }

    const currentMode = overrideMode || travelMode
    const currentPolicy = overridePolicy !== undefined ? overridePolicy : drivePolicy
    const originName = userCoordsRef.current && !startPointCoords ? '我的位置' : startPointName
    const routeOriginName = points?.originName ?? originName
    const routeDestinationName = points?.destinationName ?? endPointName

    setIsRouting(true)
    setRouteError(null)

    // 清除上一次路线
    clearRouteOverlays()

    // 实例化高德官方路线规划服务
    let routingService: any = null
    if (currentMode === 'drive') {
      if (!AMap.Driving) {
        setRouteError('驾车规划模块正在加载中')
        setIsRouting(false)
        onComplete?.(new Error('驾车规划模块正在加载中'))
        return
      }
      routingService = new AMap.Driving({
        policy: currentPolicy
      })
    } else if (currentMode === 'ride') {
      if (!AMap.Riding) {
        setRouteError('骑行规划模块正在加载中')
        setIsRouting(false)
        onComplete?.(new Error('骑行规划模块正在加载中'))
        return
      }
      routingService = new AMap.Riding()
    } else {
      if (!AMap.Walking) {
        setRouteError('步行规划模块正在加载中')
        setIsRouting(false)
        onComplete?.(new Error('步行规划模块正在加载中'))
        return
      }
      routingService = new AMap.Walking()
    }

    routingService.search(
      origin,
      routeDestination,
      (status: string, result: any) => {
        setIsRouting(false)
        if (status === 'complete' && result?.routes?.length > 0) {
          const route = result.routes[0]
          const distanceMeters = route.distance || 0
          const timeSeconds = route.time || 0

          const distanceText =
            distanceMeters >= 1000
              ? `${(distanceMeters / 1000).toFixed(1)} 公里`
              : `${Math.round(distanceMeters)} 米`

          const timeText =
            timeSeconds >= 3600
              ? `${Math.floor(timeSeconds / 3600)}小时${Math.ceil((timeSeconds % 3600) / 60)}分钟`
              : `${Math.max(1, Math.ceil(timeSeconds / 60))} 分钟`

          // 连接所有路段点集
          const fullPath: any[] = []
          if (Array.isArray(route.steps)) {
            route.steps.forEach((step: any) => {
              if (Array.isArray(step.path)) {
                fullPath.push(...step.path)
              }
            })
          }

          if (fullPath.length > 0) {
            // 贾维斯能量路径底层微光外晕
            const outlinePolyline = new AMap.Polyline({
              path: fullPath,
              isOutline: false,
              strokeColor: '#003a5c',
              strokeOpacity: 0.85,
              strokeWeight: 8,
              strokeJoin: 'round',
              strokeCap: 'round',
              zIndex: 48
            })

            // 顶层能量光束主线（高精度青蓝）
            const corePolyline = new AMap.Polyline({
              path: fullPath,
              isOutline: false,
              strokeColor: '#00f0ff',
              strokeOpacity: 0.95,
              strokeWeight: 4,
              strokeJoin: 'round',
              strokeCap: 'round',
              zIndex: 50
            })

            map.add([outlinePolyline, corePolyline])
            routePolylinesRef.current = [outlinePolyline, corePolyline]

            // 提取前几个路段点用于计算起始方位角
            try {
              const pts: [number, number][] = []
              fullPath.forEach((pt: any) => {
                if (typeof pt.getLng === 'function') {
                  pts.push([pt.getLng(), pt.getLat()])
                } else if (Array.isArray(pt)) {
                  pts.push([pt[0], pt[1]])
                } else if (typeof pt.lng === 'number' && typeof pt.lat === 'number') {
                  pts.push([pt.lng, pt.lat])
                }
              })
              routePathPointsRef.current = pts
            } catch {
              // ignore
            }
          }

          // 起点全息标记（青绿色科技标牌）
          const startLabel = routeOriginName.length > 10 ? routeOriginName.slice(0, 10) + '...' : routeOriginName
          const startMarker = new AMap.Marker({
            position: origin,
            content: `
              <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);pointer-events:none;">
                <div style="background:rgba(2,14,28,0.92);border:1px solid #00ffaa;border-radius:2px;padding:2px 6px;color:#00ffaa;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 0 10px rgba(0,255,170,0.4);margin-bottom:3px;font-family:inherit;">
                  起 · ${startLabel}
                </div>
                <div style="width:20px;height:20px;border-radius:50%;background:rgba(0,255,170,0.2);border:2px solid #00ffaa;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px #00ffaa;">
                  <div style="width:6px;height:6px;border-radius:50%;background:#ffffff;"></div>
                </div>
              </div>
            `,
            offset: new AMap.Pixel(0, 0),
            zIndex: 100
          })

          // 终点全息标记（橙红色科技标牌）
          const endLabel = routeDestinationName.length > 10 ? routeDestinationName.slice(0, 10) + '...' : routeDestinationName
          const endMarker = new AMap.Marker({
            position: routeDestination,
            content: `
              <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);pointer-events:none;">
                <div style="background:rgba(2,14,28,0.92);border:1px solid #ff4466;border-radius:2px;padding:2px 6px;color:#ff4466;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 0 10px rgba(255,68,102,0.4);margin-bottom:3px;font-family:inherit;">
                  终 · ${endLabel}
                </div>
                <div style="width:20px;height:20px;border-radius:50%;background:rgba(255,68,102,0.2);border:2px solid #ff4466;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px #ff4466;">
                  <div style="width:6px;height:6px;border-radius:50%;background:#ffffff;"></div>
                </div>
              </div>
            `,
            offset: new AMap.Pixel(0, 0),
            zIndex: 100
          })

          map.add([startMarker, endMarker])
          startMarkerRef.current = startMarker
          endMarkerRef.current = endMarker

          // 自动平滑调整视野，完整展现整条路线
          try {
            map.setFitView([startMarker, endMarker, ...routePolylinesRef.current], false, [90, 90, 90, 90])
          } catch {
            // ignore
          }

          const policyNames: Record<number, string> = {
            0: '推荐',
            4: '避堵',
            1: '少收费',
            2: '距离短'
          }
          const modeDesc =
            currentMode === 'drive'
              ? `驾车(${policyNames[currentPolicy] || '推荐'})`
              : currentMode === 'ride'
                ? '骑行'
                : '步行'

          setRouteInfo({
            distanceText,
            timeText,
            modeText: modeDesc
          })
          onComplete?.(null, createPlannedRouteResult({ origin: routeOriginName, destination: routeDestinationName, mode: currentMode, distanceMeters, durationSeconds: timeSeconds }))
        } else {
          setRouteError('未能规划出可行路线，请核对起终点道路连通性')
          onComplete?.(new Error('未能规划出可行路线，请核对起终点道路连通性'))
        }
      }
    )
  }

  mapCommandHandlerRef.current = (command) => {
      const complete = (error: Error | null, result?: unknown): void => {
        if (!error && command.type === 'planRoute' && result && typeof result === 'object' && 'status' in result && result.status === 'planned') {
          handleStartNavigation(userCoordsRef.current ?? undefined)
        }
        window.holoMap?.completeCommand({
          id: command.id,
          success: !error,
          ...(error ? { error: error.message } : { result }),
        })
      }
      if (mapInitializationError) return complete(new Error(mapInitializationError))
      if (command.type === 'getCurrentLocation') {
        const respondWithLocation = (longitude: number, latitude: number): void => {
          complete(null, { latitude, longitude, address: currentAddress.slice(0, 300) })
        }
        if (userCoordsRef.current) {
          respondWithLocation(userCoordsRef.current[0], userCoordsRef.current[1])
          return
        }
        if (!navigator.geolocation) return complete(new Error('Windows 未提供设备定位服务'))
        navigator.geolocation.getCurrentPosition(
          position => respondWithLocation(position.coords.longitude, position.coords.latitude),
          () => complete(new Error('无法获取设备当前位置，请检查 Windows 定位权限')),
          { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
        )
      } else if (command.type === 'searchNearby') {
        handleSearchNearby(command.payload.category, 'current', (error, places) => {
          if (error) return complete(error)
          complete(null, { places: (places ?? []).slice(0, 5).map(({ name, address, distance }) => ({ name, address, distanceMeters: distance })) })
        })
      } else if (command.type === 'planRoute') {
        const AMap = aMapSDKRef.current
        if (!AMap?.PlaceSearch) return complete(new Error('高德目的地搜索模块未就绪'))
        const placeSearch = new AMap.PlaceSearch({ city: userCityRef.current || '全国', pageSize: 5, pageIndex: 1, extensions: 'base' })
        placeSearch.search(command.payload.destination, (status: string, result: any) => {
          if (status !== 'complete' || !Array.isArray(result?.poiList?.pois) || result.poiList.pois.length === 0) {
            return complete(new Error(`没有找到目的地“${command.payload.destination}”`))
          }
          const candidates: Array<{ poi: any; name: string; address: string }> = result.poiList.pois.slice(0, 5).map((poi: any) => ({
            poi,
            name: String(poi.name ?? '').slice(0, 120),
            address: String(poi.address ?? poi.district ?? '').slice(0, 300),
          }))
          if (candidates.length > 1) {
            setRouteCandidates(candidates.map(({ name, address }) => ({ name, address })))
            setRouteCommandNotice(command.payload.destination)
            setRouteCandidateMode(command.payload.mode)
            setDiagStatus(`找到多个「${command.payload.destination}」候选地点，请在路线终点列表中选择`)
            return complete(null, { status: 'needsSelection', destination: command.payload.destination, candidates: candidates.map(({ name, address }) => ({ name, address })) })
          }
          const selected = candidates[0]!
          const location = selected.poi.location
          const coords: [number, number] = [Number(location.lng), Number(location.lat)]
          if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return complete(new Error('目的地没有可用于路线规划的坐标'))
          setStartPointName(currentAddress)
          setStartPointCoords(userCoordsRef.current)
          setEndPointName(selected.name)
          setEndPointCoords(coords)
          setRouteCandidates([])
          setRouteCommandNotice('')
          setTravelMode(command.payload.mode)
          const origin = userCoordsRef.current
          if (!origin) return complete(new Error('无法获取设备当前位置，请检查 Windows 定位权限'))
          handlePlanRoute(command.payload.mode, undefined, complete, {
            origin,
            destination: coords,
            originName: currentAddress || '我的位置',
            destinationName: selected.name,
          })
        })
      }
  }

  useEffect(() => {
    if (!window.holoMap) return
    const unsubscribe = window.holoMap.onCommand(command => mapCommandHandlerRef.current?.(command))
    return unsubscribe
  }, [])

  useEffect(() => {
    if (window.holoMap && (mapInitializationError || (mapReady && locationResolved))) window.holoMap.ready()
  }, [mapReady, mapInitializationError, locationResolved])

  // 路线视角一键全景自适应
  const handleRefocusRoute = (): void => {
    const map = mapInstanceRef.current
    if (map && startMarkerRef.current && endMarkerRef.current) {
      try {
        setIsNavigating(false)
        map.setFitView(
          [startMarkerRef.current, endMarkerRef.current, ...routePolylinesRef.current],
          false,
          [90, 90, 90, 90]
        )
      } catch {
        // ignore
      }
    }
  }

  // 开始全息导航：沉浸式贴地超近距离特写视角（近地 Zoom 19.5 + 仰角 72° + 沿路线朝向旋转）
  const handleStartNavigation = (originOverride?: [number, number]): void => {
    const map = mapInstanceRef.current
    const origin = originOverride ?? startPointCoords
    if (!map || !origin) return

    setIsNavigating(true)

    // 计算初始路段的朝向角度（航向角）
    let initialRotation = -15
    const pts = routePathPointsRef.current
    if (pts.length >= 2) {
      const p1 = pts[0]
      // 找到一个距离稍微拉开一点的点，以求出稳定的航向
      let p2 = pts[1]
      for (let i = 1; i < Math.min(pts.length, 10); i++) {
        const dx = pts[i][0] - p1[0]
        const dy = pts[i][1] - p1[1]
        if (Math.abs(dx) > 0.00005 || Math.abs(dy) > 0.00005) {
          p2 = pts[i]
          break
        }
      }
      const dLng = p2[0] - p1[0]
      const dLat = p2[1] - p1[1]
      const angle = (Math.atan2(dLng, dLat) * 180) / Math.PI
      initialRotation = -angle // 高德地图 rotation 顺逆时针换算
    }

    try {
      // 强聚焦至起点极近视角：Zoom 19.5, 俯仰角 72° 第一人称驾车贴地全息视角
      map.setZoomAndCenter(19.5, origin)
      map.setPitch(72)
      map.setRotation(initialRotation)
    } catch {
      // ignore
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#01050c',
        overflow: 'hidden',
        color: JARVIS_THEME.primary,
        fontFamily: '"Segoe UI", "Consolas", -apple-system, sans-serif',
        userSelect: 'none'
      }}
    >
      {/* 隐藏高德地图自带 logo、版权与状态标识 */}
      <style>{`
        .amap-logo,
        .amap-copyright,
        .amap-m-logo,
        .amap-m-copyright {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
        input::placeholder {
          color: #436d8d;
        }
      `}</style>

      {/* 1. 高德 WebGL 3D 暗夜全息底图容器 */}
      <div
        ref={mapContainerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 1
        }}
      />

      {/* 2. 雨雪天气特效覆盖层（跟随实况天气自动启停） */}
      <WeatherFxOverlay mode={weatherFx} />

      {/* 2.0 心知天气 SenseMap 雷达图层（开关由顶部「⛈️ 雷达」按钮控制） */}
      <SenseMapRadarLayer
        map={mapReady}
        enabled={radarEnabled}
        opacity={radarOpacity}
        onStatusChange={(s) => {
          if (s.phase === 'ready') setRadarStatus('就绪')
          else if (s.phase === 'loading') setRadarStatus('加载中')
          else if (s.phase === 'error') setRadarStatus('雷达不可用')
          else setRadarStatus('待机')
        }}
      />

      {/* 2.1 东南西北方位罗盘（右上角，跟随地图旋转，点击回正正北） */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 45,
          cursor: 'pointer',
          userSelect: 'none'
        }}
        title="方位罗盘 · 点击回正正北"
        onClick={() => {
          const map = mapInstanceRef.current
          if (!map) return
          map.setRotation(0)
          setCompassRotation(0)
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '86px',
            height: '86px',
            borderRadius: '50%',
            background: JARVIS_THEME.bg,
            border: `1px solid ${JARVIS_THEME.border}`,
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6), inset 0 0 20px rgba(0, 240, 255, 0.08)',
            transform: `rotate(${compassRotation}deg)`,
            transition: 'transform 0.15s linear',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {/* 内圈刻度 */}
          <div
            style={{
              position: 'absolute',
              inset: '6px',
              borderRadius: '50%',
              border: '1px dashed rgba(0, 240, 255, 0.25)'
            }}
          />
          {/* N 红色指向标记 */}
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: '9px solid #ff4d5e',
              filter: 'drop-shadow(0 0 4px #ff4d5e)'
            }}
          />
          <span
            style={{
              position: 'absolute',
              top: '19px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '9px',
              fontWeight: 800,
              color: '#ff5b6e',
              textShadow: '0 0 6px rgba(255, 77, 94, 0.8)'
            }}
          >
            N
          </span>
          {/* S / E / W 文字反向旋转保持正立 */}
          <span
            style={{
              position: 'absolute',
              bottom: '6px',
              left: '50%',
              transform: `translateX(-50%) rotate(${-compassRotation}deg)`,
              fontSize: '9px',
              fontWeight: 700,
              color: '#00f0ff',
              textShadow: '0 0 6px rgba(0, 240, 255, 0.8)'
            }}
          >
            S
          </span>
          <span
            style={{
              position: 'absolute',
              top: '50%',
              right: '7px',
              transform: `translateY(-50%) rotate(${-compassRotation}deg)`,
              fontSize: '9px',
              fontWeight: 700,
              color: '#00f0ff',
              textShadow: '0 0 6px rgba(0, 240, 255, 0.8)'
            }}
          >
            E
          </span>
          <span
            style={{
              position: 'absolute',
              top: '50%',
              left: '7px',
              transform: `translateY(-50%) rotate(${-compassRotation}deg)`,
              fontSize: '9px',
              fontWeight: 700,
              color: '#00f0ff',
              textShadow: '0 0 6px rgba(0, 240, 255, 0.8)'
            }}
          >
            W
          </span>
          {/* 中心定位点 */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#00f0ff',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 8px #00f0ff'
            }}
          />
        </div>
      </div>

      {/* 3. 背景微弱暗角边缘光晕（增强全息纵深与沉浸感） */}
      {mapTheme === 'holo' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 5,
            boxShadow: 'inset 0 0 140px rgba(0, 0, 0, 0.85)'
          }}
        />
      )}

      {/* 3. 极简贾维斯全息沙盘状态与回正条（顶部） */}
      <div
        style={{
          position: 'absolute',
          top: '18px',
          left: '20px',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 16px',
          background: JARVIS_THEME.bg,
          border: `1px solid ${JARVIS_THEME.border}`,
          backdropFilter: 'blur(10px)',
          borderRadius: '3px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)'
        }}
      >
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: JARVIS_THEME.primary,
            boxShadow: `0 0 10px ${JARVIS_THEME.primary}`
          }}
        />
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '1.2px',
            color: JARVIS_THEME.primary
          }}
        >
          JARVIS HOLO-MAP
        </span>
        <span style={{ fontSize: '11px', color: '#274768' }}>|</span>
        <span style={{ fontSize: '11px', color: '#7bb0da' }}>{diagStatus}</span>
        <span style={{ fontSize: '11px', color: '#274768' }}>|</span>
        <span style={{ fontSize: '11px', color: '#00f0ff' }}>FPS: {fps}</span>
        {weatherInfo && (
          <>
            <span style={{ fontSize: '11px', color: '#274768' }}>|</span>
            <span
              style={{ fontSize: '11px', color: '#ffd76a', cursor: 'pointer' }}
              title={`${weatherInfo.city} · 湿度 ${weatherInfo.humidity}% · ${weatherInfo.winddirection}${weatherInfo.windpower}级 · 点击切换特效：自动/雨/雪`}
              onClick={() => {
                const next: 'auto' | 'rain' | 'snow' =
                  weatherFxMode === 'auto' ? 'rain' : weatherFxMode === 'rain' ? 'snow' : 'auto'
                weatherFxModeRef.current = next
                setWeatherFxMode(next)
                if (next === 'rain') setWeatherFx('rain')
                else if (next === 'snow') setWeatherFx('snow')
                else if (weatherInfo) {
                  const w = weatherInfo.weather
                  if (w.includes('雪')) setWeatherFx('snow')
                  else if (w.includes('雨') || w.includes('雷')) setWeatherFx('rain')
                  else setWeatherFx('none')
                }
              }}
            >
              {weatherInfo.weather} {weatherInfo.temperature}°C
              <span style={{ color: weatherFxMode === 'auto' ? '#7195b6' : '#00f0ff', marginLeft: '4px' }}>
                [{weatherFxMode === 'auto' ? '自动' : weatherFxMode === 'rain' ? '雨' : '雪'}]
              </span>
            </span>
          </>
        )}
        <span style={{ fontSize: '11px', color: '#274768' }}>|</span>
        <button
          onClick={handleRecenter}
          title="回正至当前精准定位"
          style={{
            background: 'rgba(0, 240, 255, 0.12)',
            border: `1px solid ${JARVIS_THEME.border}`,
            color: JARVIS_THEME.primary,
            borderRadius: '2px',
            padding: '2px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontFamily: 'inherit'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 240, 255, 0.25)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 240, 255, 0.12)'
          }}
        >
          📍 回正定位 ({currentAddress.length > 14 ? currentAddress.slice(0, 14) + '...' : currentAddress})
        </button>
        <span style={{ fontSize: '11px', color: '#274768' }}>|</span>
        <button
          onClick={handleToggleMapTheme}
          title="在全息科技暗调与高德官方标准地图样式之间切换"
          style={{
            background: mapTheme === 'holo' ? 'rgba(0, 240, 255, 0.15)' : 'rgba(0, 150, 255, 0.28)',
            border: mapTheme === 'holo' ? `1px solid ${JARVIS_THEME.border}` : '1px solid #00a6ff',
            color: mapTheme === 'holo' ? '#00f0ff' : '#ffffff',
            borderRadius: '2px',
            padding: '2px 9px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontFamily: 'inherit',
            boxShadow: mapTheme === 'holo' ? '0 0 8px rgba(0, 240, 255, 0.2)' : '0 0 8px rgba(0, 150, 255, 0.3)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.85'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          {mapTheme === 'holo' ? '🗺️ 切换高德官方标准' : '🌌 切换贾维斯暗夜全息'}
        </button>
        <span style={{ fontSize: '11px', color: '#274768' }}>|</span>
        <button
          onClick={() => {
            const nextState = !isNearbyPanelOpen
            setIsNearbyPanelOpen(nextState)
            if (nextState && nearbyPOIs.length === 0) {
              handleSearchNearby(nearbyCategory)
            }
          }}
          title="搜寻地图当前视窗周边的美食、商圈、生活设施等商家"
          style={{
            background: isNearbyPanelOpen ? 'rgba(0, 255, 170, 0.22)' : 'rgba(255, 255, 255, 0.08)',
            border: isNearbyPanelOpen ? '1px solid #00ffaa' : '1px solid rgba(255, 255, 255, 0.2)',
            color: isNearbyPanelOpen ? '#00ffaa' : '#8ba7c4',
            borderRadius: '2px',
            padding: '2px 9px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontFamily: 'inherit',
            boxShadow: isNearbyPanelOpen ? '0 0 10px rgba(0, 255, 170, 0.3)' : 'none'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.85'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          {isNearbyPanelOpen ? '🏬 隐藏周边商家' : '🏬 探索附近商家'}
        </button>
        <span style={{ fontSize: '11px', color: '#274768' }}>|</span>
        <button
          onClick={() => setRadarEnabled(!radarEnabled)}
          title="心知天气 SenseMap 雷达图层（公测密钥）：开启后叠加降水雷达回波；再点关闭"
          style={{
            background: radarEnabled ? 'rgba(255, 180, 0, 0.22)' : 'rgba(255, 255, 255, 0.08)',
            border: radarEnabled ? '1px solid #ffb400' : '1px solid rgba(255, 255, 255, 0.2)',
            color: radarEnabled ? '#ffd76a' : '#8ba7c4',
            borderRadius: '2px',
            padding: '2px 9px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontFamily: 'inherit',
            boxShadow: radarEnabled ? '0 0 8px rgba(255, 180, 0, 0.3)' : 'none'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.85'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          ⛈️ 雷达 {radarEnabled ? '开' : '关'}
        </button>
        {radarEnabled && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: '#7bb0da'
            }}
          >
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={radarOpacity}
              onChange={(e) => setRadarOpacity(Number(e.target.value))}
              style={{ width: 88, accentColor: '#00f0ff', cursor: 'pointer' }}
              title="雷达图层透明度"
            />
            {Math.round(radarOpacity * 100)}% · {radarStatus}
          </span>
        )}


      </div>

      {/* 4. 出发点与终点路线规划面板（类似高德地图，极简贾维斯暗夜科技风，左上角） */}
      <div
        style={{
          position: 'absolute',
          top: '64px',
          left: '20px',
          zIndex: 35,
          width: '320px',
          background: JARVIS_THEME.bg,
          border: `1px solid ${pickingTarget ? '#00ffaa' : JARVIS_THEME.border}`,
          borderRadius: '4px',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.75)',
          overflow: 'visible',
          transition: 'border 0.2s ease'
        }}
      >
        {/* 面板头部条 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: isRoutePanelOpen ? '1px solid rgba(0, 240, 255, 0.15)' : 'none',
            cursor: 'pointer'
          }}
          onClick={() => setIsRoutePanelOpen(!isRoutePanelOpen)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px' }}>🧭</span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '1px',
                color: JARVIS_THEME.primary
              }}
            >
              路线导航 / NAVIGATION
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#5786a8' }}>
            {isRoutePanelOpen ? '▲ 折叠' : '▼ 展开'}
          </span>
        </div>

        {isRoutePanelOpen && (
          <div style={{ padding: '12px' }}>
            {/* 出行模式切换 Tab */}
            <div
              style={{
                display: 'flex',
                gap: '6px',
                marginBottom: '12px',
                background: 'rgba(0, 20, 40, 0.6)',
                padding: '3px',
                borderRadius: '3px',
                border: '1px solid rgba(0, 240, 255, 0.12)'
              }}
            >
              {(
                [
                  { key: 'drive', label: '🚗 驾车' },
                  { key: 'ride', label: '🚲 骑行' },
                  { key: 'walk', label: '🚶 步行' }
                ] as const
              ).map((tab) => {
                const isActive = travelMode === tab.key
                return (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setTravelMode(tab.key)
                      // 若起终点已设置，切换模式立即触发即时重算规划
                      if (startPointCoords && endPointCoords) {
                        handlePlanRoute(tab.key, drivePolicy)
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '4px 0',
                      fontSize: '11px',
                      fontWeight: isActive ? 700 : 400,
                      background: isActive ? 'rgba(0, 240, 255, 0.22)' : 'transparent',
                      border: isActive ? `1px solid ${JARVIS_THEME.border}` : '1px solid transparent',
                      color: isActive ? '#00f0ff' : '#6f9ab8',
                      borderRadius: '2px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: 'inherit'
                    }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* 驾车策略二级切换栏：驾车推荐 / 躲避拥堵 / 费用最低 / 距离最短 */}
            {travelMode === 'drive' && (
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  marginBottom: '10px',
                  padding: '2px 0'
                }}
              >
                {(
                  [
                    { policy: 0, label: '推荐模式' },
                    { policy: 4, label: '躲避拥堵' },
                    { policy: 1, label: '少收费' },
                    { policy: 2, label: '距离最短' }
                  ] as const
                ).map((item) => {
                  const isPolicyActive = drivePolicy === item.policy
                  return (
                    <button
                      key={item.policy}
                      onClick={() => {
                        setDrivePolicy(item.policy)
                        if (startPointCoords && endPointCoords) {
                          handlePlanRoute('drive', item.policy)
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '3px 0',
                        fontSize: '10px',
                        fontWeight: isPolicyActive ? 700 : 400,
                        background: isPolicyActive ? 'rgba(0, 240, 255, 0.16)' : 'rgba(0, 20, 40, 0.4)',
                        border: isPolicyActive
                          ? '1px solid rgba(0, 240, 255, 0.5)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        color: isPolicyActive ? '#00f0ff' : '#6f9ab8',
                        borderRadius: '2px',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease',
                        fontFamily: 'inherit'
                      }}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 起点与终点输入组合布局 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '10px'
              }}
            >
              {/* 左侧起点终点圆点指示轴 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 0'
                }}
              >
                <div
                  title="出发点"
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: '#00ffaa',
                    boxShadow: '0 0 6px #00ffaa'
                  }}
                />
                <div
                  style={{
                    width: '1px',
                    height: '24px',
                    background: 'linear-gradient(to bottom, #00ffaa, #ff4466)'
                  }}
                />
                <div
                  title="目的地"
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: '#ff4466',
                    boxShadow: '0 0 6px #ff4466'
                  }}
                />
              </div>

              {/* 中间输入框区域 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
                {/* 1. 出发点输入 */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={startPointName}
                    placeholder="输入出发点..."
                    onChange={(e) => handleKeywordChange('start', e.target.value)}
                    onFocus={() => setActiveSuggestionField('start')}
                    style={{
                      width: '100%',
                      background: 'rgba(2, 14, 30, 0.85)',
                      border: `1px solid ${pickingTarget === 'start' ? '#00ffaa' : 'rgba(0, 240, 255, 0.25)'}`,
                      borderRadius: '2px',
                      padding: '5px 50px 5px 8px',
                      color: '#ffffff',
                      fontSize: '11px',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  />
                  <div style={{ position: 'absolute', right: '4px', display: 'flex', gap: '2px' }}>
                    <button
                      onClick={handleSetStartToCurrent}
                      title="设为当前位置"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#00f0ff',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '2px 3px'
                      }}
                    >
                      🎯
                    </button>
                    <button
                      onClick={() => setPickingTarget(pickingTarget === 'start' ? null : 'start')}
                      title="在地图上点选起点"
                      style={{
                        background: pickingTarget === 'start' ? 'rgba(0, 255, 170, 0.3)' : 'transparent',
                        border: 'none',
                        color: pickingTarget === 'start' ? '#00ffaa' : '#7bb0da',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '2px 3px',
                        borderRadius: '2px'
                      }}
                    >
                      📍
                    </button>
                  </div>
                </div>

                {/* 2. 目的地输入 */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={endPointName}
                    placeholder="输入目的地或选点..."
                    onChange={(e) => handleKeywordChange('end', e.target.value)}
                    onFocus={() => setActiveSuggestionField('end')}
                    style={{
                      width: '100%',
                      background: 'rgba(2, 14, 30, 0.85)',
                      border: `1px solid ${pickingTarget === 'end' ? '#ff4466' : 'rgba(0, 240, 255, 0.25)'}`,
                      borderRadius: '2px',
                      padding: '5px 30px 5px 8px',
                      color: '#ffffff',
                      fontSize: '11px',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  />
                  <div style={{ position: 'absolute', right: '4px', display: 'flex', gap: '2px' }}>
                    <button
                      onClick={() => setPickingTarget(pickingTarget === 'end' ? null : 'end')}
                      title="在地图上点选终点"
                      style={{
                        background: pickingTarget === 'end' ? 'rgba(255, 68, 102, 0.3)' : 'transparent',
                        border: 'none',
                        color: pickingTarget === 'end' ? '#ff4466' : '#7bb0da',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: '2px 3px',
                        borderRadius: '2px'
                      }}
                    >
                      📍
                    </button>
                  </div>
                </div>

                {/* 自动联想下拉候选列表 */}
                {activeSuggestionField && suggestions.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: activeSuggestionField === 'start' ? '32px' : '68px',
                      left: 0,
                      right: 0,
                      background: 'rgba(2, 10, 22, 0.96)',
                      border: '1px solid rgba(0, 240, 255, 0.4)',
                      borderRadius: '3px',
                      zIndex: 100,
                      maxHeight: '160px',
                      overflowY: 'auto',
                      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.8)'
                    }}
                  >
                    {suggestions.map((item, idx) => (
                      <div
                        key={idx}
                        onMouseDown={() => handleSelectSuggestion(activeSuggestionField, item)}
                        style={{
                          padding: '6px 8px',
                          borderBottom:
                            idx === suggestions.length - 1 ? 'none' : '1px solid rgba(0, 240, 255, 0.1)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(0, 240, 255, 0.18)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <span style={{ fontSize: '11px', color: '#ffffff', fontWeight: 600 }}>
                          {item.name}
                        </span>
                        <span
                          style={{
                            fontSize: '9px',
                            color: '#6fa5c7',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {item.address || item.district}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 右侧对调起点终点按钮 */}
              <button
                onClick={handleSwapPoints}
                title="对调起点和终点"
                style={{
                  background: 'rgba(0, 240, 255, 0.1)',
                  border: `1px solid ${JARVIS_THEME.border}`,
                  color: JARVIS_THEME.primary,
                  borderRadius: '3px',
                  width: '28px',
                  height: '56px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 240, 255, 0.25)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 240, 255, 0.1)'
                }}
              >
                ↕
              </button>
            </div>

            {/* 点选模式下的友好指引 */}
            {pickingTarget && (
              <div
                style={{
                  marginBottom: '8px',
                  padding: '4px 8px',
                  background:
                    pickingTarget === 'start' ? 'rgba(0, 255, 170, 0.15)' : 'rgba(255, 68, 102, 0.15)',
                  border: `1px solid ${pickingTarget === 'start' ? '#00ffaa' : '#ff4466'}`,
                  borderRadius: '2px',
                  fontSize: '10px',
                  color: pickingTarget === 'start' ? '#00ffaa' : '#ff4466',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span>
                  🎯 请在地图上点击任意位置确定{pickingTarget === 'start' ? '出发点' : '目的地'}
                </span>
                <span
                  onClick={() => setPickingTarget(null)}
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                >
                  取消
                </span>
              </div>
            )}

            {/* 错误提示 */}
            {routeError && (
              <div
                style={{
                  marginBottom: '8px',
                  padding: '4px 8px',
                  background: 'rgba(255, 70, 70, 0.15)',
                  border: '1px solid rgba(255, 70, 70, 0.4)',
                  borderRadius: '2px',
                  fontSize: '10px',
                  color: '#ff7070'
                }}
              >
                ⚠️ {routeError}
              </div>
            )}

            {/* 操作按钮栏 */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handlePlanRoute()}
                disabled={isRouting}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: isRouting ? 'rgba(0, 240, 255, 0.08)' : 'rgba(0, 240, 255, 0.22)',
                  border: `1px solid ${JARVIS_THEME.primary}`,
                  color: JARVIS_THEME.primary,
                  borderRadius: '2px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: isRouting ? 'wait' : 'pointer',
                  letterSpacing: '1px',
                  transition: 'all 0.15s ease',
                  fontFamily: 'inherit',
                  boxShadow: '0 0 10px rgba(0, 240, 255, 0.2)'
                }}
                onMouseEnter={(e) => {
                  if (!isRouting) e.currentTarget.style.background = 'rgba(0, 240, 255, 0.35)'
                }}
                onMouseLeave={(e) => {
                  if (!isRouting) e.currentTarget.style.background = 'rgba(0, 240, 255, 0.22)'
                }}
              >
                {isRouting ? '⚡ 正在全息计算规划...' : '⚡ 开始路线规划'}
              </button>

              <button
                onClick={handleClearRoute}
                title="清空规划路线与标记"
                style={{
                  padding: '6px 12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#8da6be',
                  borderRadius: '2px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontFamily: 'inherit'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ffffff'
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.4)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#8da6be'
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)'
                }}
              >
                清空
              </button>
            </div>

            {/* 规划成功后的路线结果信息卡片 */}
            {routeInfo && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '8px 10px',
                  background: 'rgba(0, 25, 45, 0.8)',
                  border: '1px solid rgba(0, 240, 255, 0.3)',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#00f0ff' }}>
                      {routeInfo.timeText}
                    </span>
                    <span style={{ fontSize: '12px', color: '#8ac4ec' }}>
                      {routeInfo.distanceText}
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 4px',
                        background: 'rgba(0, 240, 255, 0.15)',
                        border: '1px solid rgba(0, 240, 255, 0.3)',
                        borderRadius: '2px',
                        color: '#00f0ff'
                      }}
                    >
                      {routeInfo.modeText.includes('推荐') || routeInfo.modeText.includes('(') ? routeInfo.modeText : `${routeInfo.modeText}模式`}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => handleStartNavigation()}
                    title="聚焦至起点超近距离第一人称导航视角"
                    style={{
                      background: isNavigating
                        ? 'linear-gradient(135deg, rgba(0, 255, 170, 0.35), rgba(0, 240, 255, 0.45))'
                        : 'linear-gradient(135deg, rgba(0, 255, 170, 0.2), rgba(0, 240, 255, 0.25))',
                      border: isNavigating ? '1px solid #00ffaa' : '1px solid rgba(0, 255, 170, 0.6)',
                      color: isNavigating ? '#ffffff' : '#00ffaa',
                      borderRadius: '2px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      boxShadow: isNavigating
                        ? '0 0 14px rgba(0, 255, 170, 0.6)'
                        : '0 0 8px rgba(0, 255, 170, 0.25)',
                      letterSpacing: '0.5px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {isNavigating ? '🚀 正在沉浸导航' : '🚀 开始导航'}
                  </button>

                  <button
                    onClick={handleRefocusRoute}
                    title="全景视角完整展示整条路线"
                    style={{
                      background: 'rgba(0, 240, 255, 0.12)',
                      border: '1px solid rgba(0, 240, 255, 0.35)',
                      color: '#00f0ff',
                      borderRadius: '2px',
                      padding: '4px 8px',
                      fontSize: '10px',
                      cursor: 'pointer',
                      fontFamily: 'inherit'
                    }}
                  >
                    🔍 全景
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

            {/* 4.5 附近商家搜索与探索全息面板（右上角，罗盘下方） */}
      {isNearbyPanelOpen && (
        <div
          style={{
            position: 'absolute',
            top: '132px',
            right: '24px',
            zIndex: 36,
            width: '320px',
            maxHeight: 'calc(100vh - 220px)',
            background: JARVIS_THEME.bg,
            border: `1px solid ${JARVIS_THEME.border}`,
            borderRadius: '4px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* 面板头部 */}
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(0, 240, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(0, 240, 255, 0.05)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px' }}>🏬</span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '1px',
                  color: '#00f0ff'
                }}
              >
                附近商家 / NEARBY PLACES
              </span>
            </div>
            <button
              onClick={() => {
                clearNearbyMarkers()
                setIsNearbyPanelOpen(false)
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#7195b6',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              ✕
            </button>
          </div>

          {/* 分类快捷筛选标签 */}
          <div
            style={{
              padding: '10px 14px 6px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              borderBottom: '1px solid rgba(0, 240, 255, 0.1)'
            }}
          >
            {['美食', '咖啡', '超市', '商场', '酒店', '加油站', '电影院', '银行'].map((cat) => {
              const active = nearbyCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setNearbyCategory(cat)
                    handleSearchNearby(cat)
                  }}
                  style={{
                    background: active ? 'rgba(0, 240, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                    border: active ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.12)',
                    color: active ? '#00f0ff' : '#8daecf',
                    borderRadius: '2px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {cat}
                </button>
              )
            })}
          </div>

          {/* 搜索基准说明与刷新 */}
          <div
            style={{
              padding: '7px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: '#7195b6',
              background: 'rgba(0, 240, 255, 0.03)',
              borderBottom: '1px solid rgba(0, 240, 255, 0.08)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#00ffaa' }}>📍</span>
              <span style={{ color: '#97bad9', fontSize: '11px' }}>基准：</span>
              <button
                onClick={() => {
                  setNearbyCenter('current')
                  handleSearchNearby(nearbyCategory, 'current')
                }}
                disabled={nearbyLoading}
                style={{
                  background: nearbyCenter === 'current' ? 'rgba(0, 240, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                  border: nearbyCenter === 'current' ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.12)',
                  color: nearbyCenter === 'current' ? '#00f0ff' : '#8daecf',
                  borderRadius: '2px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                当前定位
              </button>
              <button
                onClick={() => {
                  setNearbyCenter('destination')
                  handleSearchNearby(nearbyCategory, 'destination')
                }}
                disabled={nearbyLoading || !endPointCoords}
                title={endPointCoords ? `以导航目的地「${endPointName}」为圆心搜索` : '请先在路线面板设置导航目的地'}
                style={{
                  background: nearbyCenter === 'destination' ? 'rgba(0, 240, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                  border: nearbyCenter === 'destination' ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.12)',
                  color: !endPointCoords ? '#556f86' : nearbyCenter === 'destination' ? '#00f0ff' : '#8daecf',
                  borderRadius: '2px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  cursor: !endPointCoords ? 'not-allowed' : 'pointer'
                }}
              >
                导航目的地
              </button>
              <span style={{ color: '#7195b6', fontSize: '11px' }}>· 按距离由近及远</span>
            </div>
            <button
              onClick={() => handleSearchNearby(nearbyCategory, nearbyCenter)}
              disabled={nearbyLoading}
              style={{
                background: 'rgba(0, 240, 255, 0.12)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: '#00f0ff',
                borderRadius: '2px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: nearbyLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {nearbyLoading ? '⟳ 检索中' : '⟳ 刷新'}
            </button>
          </div>

          {/* POI 列表展示 */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 10px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            {nearbyLoading && nearbyPOIs.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#5786a8', fontSize: '12px' }}>
                📡 正在扫描周边「{nearbyCategory}」商家数据...
              </div>
            ) : nearbyPOIs.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#5786a8', fontSize: '12px' }}>
                未发现附近「{nearbyCategory}」相关商家，尝试扩大范围
              </div>
            ) : (
              nearbyPOIs.map((poi, idx) => (
                <div
                  key={poi.id || idx}
                  onClick={() => focusOnPOI(poi)}
                  style={{
                    background: 'rgba(4, 18, 38, 0.65)',
                    border: '1px solid rgba(0, 240, 255, 0.12)',
                    borderRadius: '3px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 240, 255, 0.1)'
                    e.currentTarget.style.borderColor = '#00f0ff'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(4, 18, 38, 0.65)'
                    e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.12)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <span
                        style={{
                          width: '16px',
                          height: '16px',
                          lineHeight: '16px',
                          textAlign: 'center',
                          borderRadius: '50%',
                          background: 'rgba(0, 240, 255, 0.18)',
                          color: '#00f0ff',
                          fontSize: '10px',
                          fontWeight: 700,
                          flexShrink: 0
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#ffffff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                        title={poi.name}
                      >
                        {poi.name}
                      </span>
                    </div>
                    {poi.distance > 0 && (
                      <span style={{ fontSize: '11px', color: '#00ffaa', flexShrink: 0 }}>
                        {poi.distance > 1000 ? (poi.distance / 1000).toFixed(1) + 'km' : poi.distance + 'm'}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#6e93b4',
                      lineHeight: '1.3',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                    title={poi.address}
                  >
                    📍 {poi.address}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {routeCandidates.length > 0 && (
        <aside style={{ position: 'absolute', top: 70, right: 20, zIndex: 60, width: 360, maxHeight: '55vh', overflow: 'auto', padding: 14, color: '#d9f7ff', background: 'rgba(2, 10, 22, 0.96)', border: '1px solid rgba(0, 240, 255, 0.55)', boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <strong>选择“{routeCommandNotice}”</strong>
          {routeCandidates.map((candidate, index) => (
            <button key={`${candidate.name}-${index}`} type="button" onClick={() => {
              const AMap = aMapSDKRef.current
              if (!AMap?.PlaceSearch) return
              new AMap.PlaceSearch({ city: userCityRef.current || '全国' }).search(candidate.name, (_status: string, result: any) => {
                const poi = result?.poiList?.pois?.find((item: any) => item.name === candidate.name) ?? result?.poiList?.pois?.[0]
                if (!poi?.location) return setRouteError(`无法解析目的地 ${candidate.name}`)
                setEndPointName(candidate.name)
                setEndPointCoords([Number(poi.location.lng), Number(poi.location.lat)])
                setRouteCandidates([])
                window.setTimeout(() => handlePlanRoute(routeCandidateMode), 0)
              })
            }} style={{ display: 'block', width: '100%', marginTop: 8, padding: '10px 12px', textAlign: 'left', color: '#d9f7ff', background: 'rgba(0, 240, 255, 0.08)', border: '1px solid rgba(0, 240, 255, 0.22)', cursor: 'pointer' }}>
              {candidate.name}<small style={{ display: 'block', marginTop: 4, color: '#88aabd' }}>{candidate.address}</small>
            </button>
          ))}
        </aside>
      )}
    </div>
  )
}

// ========== 雨雪天气特效覆盖层（全息克制风，低密度半透明） ==========
interface RainDrop {
  x: number
  y: number
  len: number
  speed: number
  drift: number
}
interface SnowFlake {
  x: number
  y: number
  r: number
  speed: number
  swing: number
  phase: number
}

function WeatherFxOverlay({ mode }: { mode: 'rain' | 'snow' | 'none' }): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const dropsRef = useRef<RainDrop[]>([])
  const flakesRef = useRef<SnowFlake[]>([])

  useEffect(() => {
    if (mode === 'none') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const W = canvas.width
    const H = canvas.height

    const handleResize = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    window.addEventListener('resize', handleResize)

    // 适中密度初始化：足够可见但保持克制不刺眼
    if (mode === 'rain') {
      dropsRef.current = Array.from({ length: 200 }, (): RainDrop => ({
        x: Math.random() * W,
        y: Math.random() * H,
        len: 12 + Math.random() * 10,
        speed: 9 + Math.random() * 7,
        drift: 1.6 + Math.random() * 1.8
      }))
    } else {
      flakesRef.current = Array.from({ length: 180 }, (): SnowFlake => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 1.4 + Math.random() * 2.4,
        speed: 0.8 + Math.random() * 1.2,
        swing: 0.5 + Math.random() * 1.0,
        phase: Math.random() * Math.PI * 2
      }))
    }

    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min((now - last) / 16.7, 2.5)
      last = now
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (mode === 'rain' && ctx) {
        ctx.strokeStyle = 'rgba(130, 195, 255, 0.52)'
        ctx.lineWidth = 1.3
        ctx.beginPath()
        dropsRef.current.forEach((d) => {
          d.x -= d.drift * dt
          d.y += d.speed * dt
          if (d.y - d.len > canvas.height || d.x < -20) {
            d.x = Math.random() * canvas.width
            d.y = -20 - Math.random() * 60
          }
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x - d.drift * 2, d.y + d.len)
        })
        ctx.stroke()
      } else if (mode === 'snow' && ctx) {
        flakesRef.current.forEach((f) => {
          f.phase += 0.02 * dt
          f.y += f.speed * dt
          f.x += Math.sin(f.phase) * f.swing * dt
          if (f.y > canvas.height + 10) {
            f.y = -10
            f.x = Math.random() * canvas.width
          }
          // 外层半透明光晕 + 内层亮白核心，增强可见度与立体感
          ctx.fillStyle = 'rgba(200, 225, 255, 0.28)'
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.r * 1.7, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = 'rgba(228, 242, 255, 0.85)'
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
          ctx.fill()
        })
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return (): void => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
      dropsRef.current = []
      flakesRef.current = []
    }
  }, [mode])

  if (mode === 'none') return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 6,
        pointerEvents: 'none'
      }}
    />
  )
}

export default App
