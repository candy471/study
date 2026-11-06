<template>
  <div class="min-h-screen w-full flex flex-col items-center gap-4 px-4 py-8 bg-#f5f7fa">
    <h1 class="m-0 text-2xl font-600 text-#333">多功能物理光学仿真系统</h1>

    <!-- 顶部控制区：布局用 UnoCSS 原子类，控件用 naive-ui -->
    <NCard class="w-full max-w-850px" size="small" title="仿真参数">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
        <div class="flex flex-col gap-2">
          <NText depth="3">仿真模式</NText>
          <NSelect v-model:value="mode" :options="modeOptions" />
        </div>

        <div class="flex flex-col gap-2">
          <NText depth="3">波长 λ (nm)：{{ wavelength }}</NText>
          <NSlider v-model:value="wavelength" :min="400" :max="700" :step="1" />
        </div>

        <div v-if="mode === 'double'" class="flex flex-col gap-2">
          <NText depth="3">双缝间距 d (mm)：{{ d }}</NText>
          <NSlider v-model:value="d" :min="0.1" :max="2" :step="0.05" />
        </div>

        <div v-if="mode === 'single'" class="flex flex-col gap-2">
          <NText depth="3">单缝宽度 a (mm)：{{ a }}</NText>
          <NSlider v-model:value="a" :min="0.05" :max="0.5" :step="0.01" />
        </div>

        <template v-if="mode === 'multi'">
          <div class="flex flex-col gap-2">
            <NText depth="3">光栅常数 d (mm)：{{ d }}</NText>
            <NSlider v-model:value="d" :min="0.1" :max="2" :step="0.05" />
          </div>
          <div class="flex flex-col gap-2">
            <NText depth="3">缝数 N：{{ N }}</NText>
            <NSlider v-model:value="N" :min="2" :max="10" :step="1" />
          </div>
        </template>
      </div>
    </NCard>

    <!-- 画布区域：原生 canvas 仅作绘图目标，尺寸与对齐交给原子类 -->
    <NCard class="w-full max-w-850px" size="small" title="仿真图样 / 光强分布">
      <div class="flex flex-col gap-3">
        <canvas
          ref="canvasRef"
          width="800"
          height="300"
          class="block w-full h-auto rounded bg-black touch-none cursor-ew-resize"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        />
        <canvas ref="chartRef" width="800" height="100" class="block w-full h-25 rounded bg-black" />
        <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
          <NText depth="3" class="text-xs">游标间距：{{ pixelSpan }} px = {{ mmSpan.toFixed(3) }} mm</NText>
          <NText depth="3" class="text-xs">
            换算比例：{{ MM_PER_PX.toFixed(4) }} mm/px（屏宽 {{ SCREEN_WIDTH_MM }} mm / {{ CANVAS_WIDTH }} 列）
          </NText>
        </div>
        <NText depth="3" class="text-xs">
          当前演示：{{ modeName }}，共 {{ intensities.length }} 个采样列，检出波峰 {{ peaks.length }} 个
          （红点 = 明纹，数字为相对屏幕中心的级次）；拖动红/白竖线测量间距
        </NText>
      </div>
    </NCard>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { NCard, NSelect, NSlider, NText } from 'naive-ui'

// 1. 定义响应式参数
const mode = ref('double') // 当前模式：double, single, multi
const wavelength = ref(550)
const d = ref(0.5) // 双缝间距 或 光栅常数
const a = ref(0.2) // 单缝宽度
const N = ref(5)   // 多缝的缝数
const canvasRef = ref(null)
const chartRef = ref(null) // 光强分布折线图画布
const intensities = ref([]) // 每个像素列对应的光强，范围 0~1
const peaks = ref([]) // 折线图检出的波峰：[{ x, value, order }]

// 物理尺度：画布宽度对应屏幕上的物理宽度，游标距离靠它换算成 mm
const CANVAS_WIDTH = 800 // 主画布像素宽度（与 <canvas width> 保持一致）
const SCREEN_WIDTH_MM = 30 // 屏幕代表的物理宽度 (mm)
const MM_PER_PX = SCREEN_WIDTH_MM / CANVAS_WIDTH // 每个像素列对应的毫米数
const CURSOR_HIT_RADIUS = 10 // 拖拽命中容差（画布像素）

// 两条游标的位置（画布像素坐标），左红右白
const leftX = ref(280)
const rightX = ref(520)
const dragTarget = ref(null) // 当前拖拽的游标：'left' | 'right' | null

// 两条游标的像素距离及其对应的物理距离 (mm)
const pixelSpan = computed(() => rightX.value - leftX.value)
const mmSpan = computed(() => pixelSpan.value * MM_PER_PX)

// 仿真模式下拉框选项
const modeOptions = [
  { label: '杨氏双缝干涉', value: 'double' },
  { label: '单缝衍射', value: 'single' },
  { label: '多缝(光栅)干涉', value: 'multi' },
]

// 计算当前模式的中文名称，用于底部提示
const modeName = computed(() => {
  const names = { double: '杨氏双缝干涉', single: '单缝衍射', multi: '多缝干涉' }
  return names[mode.value]
})

// 2. 波长转 RGB 颜色（保留你昨天的成果）
const wavelengthToRGB = (wavelength) => {
  let r = 0, g = 0, b = 0;
  if (wavelength >= 380 && wavelength < 440) {
    r = -(wavelength - 440) / (440 - 380); g = 0; b = 1;
  } else if (wavelength >= 440 && wavelength < 490) {
    r = 0; g = (wavelength - 440) / (490 - 440); b = 1;
  } else if (wavelength >= 490 && wavelength < 510) {
    r = 0; g = 1; b = -(wavelength - 510) / (510 - 490);
  } else if (wavelength >= 510 && wavelength < 580) {
    r = (wavelength - 510) / (580 - 510); g = 1; b = 0;
  } else if (wavelength >= 580 && wavelength < 645) {
    r = 1; g = -(wavelength - 645) / (645 - 580); b = 0;
  } else if (wavelength >= 645 && wavelength <= 780) {
    r = 1; g = 0; b = 0;
  }
  let factor = 1;
  if (wavelength >= 380 && wavelength < 420) factor = 0.3 + 0.7 * (wavelength - 380) / (420 - 380);
  else if (wavelength >= 700 && wavelength <= 780) factor = 0.3 + 0.7 * (780 - wavelength) / (780 - 700);
  return { r: Math.round(r * factor * 255), g: Math.round(g * factor * 255), b: Math.round(b * factor * 255) };
}

// 3. 波峰检测：先找局部极大值，再给明纹编级次
const PEAK_MIN_RATIO = 0.04 // 双缝/单缝：单缝第 1 级次极大只有 0.047，阈值取高了会漏峰
const PEAK_MIN_RATIO_GRATING = 0.15 // 光栅次级极大最高只有 1/N²（N=3 约 0.111），用 0.15 把它们滤掉避免误编级次

const findPeaks = (data, minRatio = PEAK_MIN_RATIO) => {
  const maxI = Math.max(...data) || 1
  const threshold = maxI * minRatio
  const found = []

  for (let i = 1; i < data.length - 1; i++) {
    const v = data[i]
    if (v < threshold) continue // 谷底/弱起伏不当波峰
    if (v < data[i - 1] || v <= data[i + 1]) continue // 不是局部极大

    const last = found[found.length - 1]
    if (last && i - last.x < 3) {
      // 3 px 内的相邻候选只留更高的那个
      if (v > last.value) {
        last.x = i
        last.value = v
      }
      continue
    }
    found.push({ x: i, value: v, order: 0 })
  }

  if (found.length === 0) return found

  // 编级次：离屏幕中心最近的峰记 0 级，左右两侧各自按离开中心的距离递增编号
  const centerX = (data.length - 1) / 2
  const zero = found.reduce((a, b) =>
    Math.abs(b.x - centerX) < Math.abs(a.x - centerX) ? b : a,
  )
  const right = found.filter((p) => p !== zero && p.x > centerX).sort((a, b) => a.x - b.x)
  const left = found.filter((p) => p !== zero && p.x < centerX).sort((a, b) => b.x - a.x)
  right.forEach((p, i) => { p.order = i + 1 })
  left.forEach((p, i) => { p.order = -(i + 1) })

  return found // 本身就是按 x 升序的
}

// 4. 在一维光强数组上画折线图，横向逐列与上方仿真图对齐
const drawChart = (data, showPeaks = true) => {
  const chart = chartRef.value
  if (!chart || data.length === 0) return
  const ctx = chart.getContext('2d')
  const width = chart.width
  const height = chart.height

  ctx.clearRect(0, 0, width, height)

  const maxI = Math.max(...data) || 1
  const rgb = wavelengthToRGB(wavelength.value)
  const top = 20 // 顶部留白，给波峰上方的级次标注留位置
  const bottom = height - 8 // I = 0 的基准线

  // 零光强基准线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, bottom)
  ctx.lineTo(width, bottom)
  ctx.stroke()

  // 横轴拉伸：每个采样点占一个像素列，与仿真图同一 x 坐标
  const toY = (v) => bottom - (v / maxI) * (bottom - top)

  ctx.beginPath()
  data.forEach((v, x) => {
    if (x === 0) ctx.moveTo(x, toY(v))
    else ctx.lineTo(x, toY(v))
  })
  ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()

  // 曲线下方淡色填充，便于观察包络
  ctx.lineTo(data.length - 1, bottom)
  ctx.lineTo(0, bottom)
  ctx.closePath()
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`
  ctx.fill()

  // 波峰：红色圆点 + 级次标注（相对屏幕中心的第 n 级明纹）
  // 过渡动画中途不标注，避免两个模式混合出的假峰乱跳
  if (!showPeaks) return

  peaks.value = findPeaks(data, mode.value === 'multi' ? PEAK_MIN_RATIO_GRATING : PEAK_MIN_RATIO)
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  let lastLabelX = Number.NEGATIVE_INFINITY

  for (const peak of peaks.value) {
    const y = toY(peak.value)
    ctx.beginPath()
    ctx.arc(peak.x, y, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ff3b30'
    ctx.fill()

    const labelX = Math.min(Math.max(peak.x, 10), width - 10)
    if (labelX - lastLabelX >= 22) { // 峰太密时跳过标注，避免文字重叠
      ctx.fillStyle = '#ff6b6b'
      ctx.fillText(peak.order > 0 ? `+${peak.order}` : `${peak.order}`, labelX, y - 5)
      lastLabelX = labelX
    }
  }
}

// 5. 计算一维光强数组（只算数，不画）
const computeIntensities = () => {
  const width = CANVAS_WIDTH
  const L = 1000 // 屏幕距离 (mm)
  const lambda_mm = wavelength.value * 1e-6 // nm 转 mm
  const data = new Array(width)

  for (let x = 0; x < width; x++) {
    // 像素坐标转物理坐标
    const x_mm = (x - width / 2) * (SCREEN_WIDTH_MM / width)

    let intensity = 0

    // 根据不同的模式应用不同的物理公式
    if (mode.value === 'double') {
      // 双缝干涉公式 I = cos^2(π d x / λ L)
      const k = (Math.PI * d.value) / (lambda_mm * L)
      intensity = Math.cos(k * x_mm) ** 2

    } else if (mode.value === 'single') {
      // 单缝衍射公式 I = (sin(α)/α)^2
      // α = π * a * x / (λ * L)
      const alpha = (Math.PI * a.value * x_mm) / (lambda_mm * L)
      // 处理极限情况 α=0 时 (sin(α)/α) = 1
      if (Math.abs(alpha) < 0.0001) {
        intensity = 1
      } else {
        intensity = (Math.sin(alpha) / alpha) ** 2
      }

    } else if (mode.value === 'multi') {
      // 多缝干涉（光栅）公式 I = (sin(Nδ)/sin(δ))^2
      // 这里为了简化显示和对比，只用干涉项，将 δ = π * d * x / (λ * L)
      const delta = (Math.PI * d.value * x_mm) / (lambda_mm * L)

      if (Math.abs(Math.sin(delta)) < 0.0001) {
        intensity = N.value ** 2 // 主极大
      } else {
        intensity = (Math.sin(N.value * delta) / Math.sin(delta)) ** 2
      }
      // 归一化处理，因为 N 的平方会使得主极大极亮，需要除以 N^2 压回 0~1 区间
      intensity = intensity / (N.value ** 2)
    }

    data[x] = intensity // 记录每个像素列的光强
  }

  return data
}

// 6. 把光强数组渲染成彩色条纹 + 游标
const renderSimulation = (data) => {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const rgb = wavelengthToRGB(wavelength.value)

  ctx.clearRect(0, 0, width, height)
  for (let x = 0; x < width; x++) {
    const intensity = data[x] ?? 0
    const finalR = Math.floor(rgb.r * intensity)
    const finalG = Math.floor(rgb.g * intensity)
    const finalB = Math.floor(rgb.b * intensity)
    ctx.fillStyle = `rgb(${finalR}, ${finalG}, ${finalB})`
    ctx.fillRect(x, 0, 1, height)
  }

  drawCursors(ctx, width, height)
}

// 7. 模式切换的 0.3s 平滑过渡：在旧/新光强数组之间逐列插值
const TRANSITION_MS = 300
let currentData = [] // 当前屏幕上显示的光强数组
let rafId = 0

const animateTo = (target) => {
  cancelAnimationFrame(rafId)
  const from = currentData.length === target.length ? currentData : target.slice()
  const startTime = performance.now()

  const step = (now) => {
    const t = Math.min((now - startTime) / TRANSITION_MS, 1)
    const e = t * t * (3 - 2 * t) // smoothstep：两端缓、中间快

    // 每个像素按缓动系数插值，条纹亮度平滑地“长”成新图样
    const frame = new Array(from.length)
    for (let i = 0; i < from.length; i++) {
      frame[i] = from[i] + (target[i] - from[i]) * e
    }
    currentData = frame
    renderSimulation(frame)
    drawChart(frame, t === 1) // 最后一帧才重新标波峰

    if (t < 1) {
      rafId = requestAnimationFrame(step)
      return
    }
    intensities.value = frame
  }

  rafId = requestAnimationFrame(step)
}

// 8. 重绘入口：animate=true 走 300ms 过渡，否则立即到位
const drawSimulation = (animate = false) => {
  const target = computeIntensities()

  if (!animate) {
    cancelAnimationFrame(rafId)
    currentData = target
    renderSimulation(target)
    drawChart(target)
    intensities.value = target
    return
  }

  animateTo(target)
}

// 9. 游标：画布上用指针拖拽两条竖线，实时换算两线间距
const drawCursors = (ctx, width, height) => {
  // 两条游标之间的测量区域（淡白色高亮）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.fillRect(leftX.value, 0, rightX.value - leftX.value, height)

  const drawOne = (x, color, label, labelColor) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()

    // 顶部拖拽把手，避免细线不好点中
    const handleX = Math.min(Math.max(x - 9, 0), width - 18)
    ctx.fillStyle = color
    ctx.fillRect(handleX, 0, 18, 14)

    ctx.fillStyle = labelColor
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, handleX + 9, 7)
  }

  drawOne(leftX.value, '#ff3b30', 'A', '#fff')
  drawOne(rightX.value, '#ffffff', 'B', '#000')
}

// 客户端坐标 → 画布像素坐标（画布被 CSS 缩放时会差一个比例）
const toCanvasX = (event) => {
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  return (event.clientX - rect.left) * (canvas.width / rect.width)
}

const onPointerDown = (event) => {
  const canvas = canvasRef.value
  if (!canvas) return
  const x = toCanvasX(event)
  const dl = Math.abs(x - leftX.value)
  const dr = Math.abs(x - rightX.value)
  if (Math.min(dl, dr) > CURSOR_HIT_RADIUS) return // 没点中任何游标

  dragTarget.value = dl <= dr ? 'left' : 'right'
  canvas.setPointerCapture(event.pointerId)
  event.preventDefault()
}

const onPointerMove = (event) => {
  if (!dragTarget.value) return
  const canvas = canvasRef.value
  if (!canvas) return
  const x = Math.min(Math.max(toCanvasX(event), 0), canvas.width)

  if (dragTarget.value === 'left') {
    leftX.value = Math.min(x, rightX.value - 1) // 不允许越过另一条游标
  } else {
    rightX.value = Math.max(x, leftX.value + 1)
  }
  renderSimulation(currentData) // 只重画游标位置，光强数组不变
}

const onPointerUp = (event) => {
  if (!dragTarget.value) return
  const canvas = canvasRef.value
  if (canvas?.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId)
  }
  dragTarget.value = null
}

// 10. 模式切换走 0.3s 平滑过渡（只插值亮度，不动物理公式）；滑块拖动仍即时响应
watch(mode, () => drawSimulation(true))
watch([wavelength, d, a, N], () => drawSimulation())

// 11. 初始化
onMounted(() => {
  nextTick(() => {
    drawSimulation()
  })
})

// 卸载时停掉未完成的过渡动画
onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
})
</script>
