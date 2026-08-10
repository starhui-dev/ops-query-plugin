import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"

const BACKGROUND_URL = "https://api.armoe.cn/acg/random"
const BACKGROUND_TIMEOUT_MS = 8000
const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024
const resourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../resources")

export async function renderStatusImage(data, saveId) {
  return renderImage(data, saveId, "status")
}

export async function renderChannelsImage(data, saveId) {
  return renderImage(data, saveId, "channels")
}

async function renderImage(data, saveId, template) {
  let backgroundImage
  try {
    backgroundImage = fileDataUri(path.join(resourceRoot, "fallback-background.webp"), "image/webp")
  } catch (error) {
    logger.error(`[运维查询] 备用背景读取失败：${errorMessage(error)}`)
    return false
  }

  try {
    backgroundImage = await fetchBackgroundImage()
  } catch (error) {
    logger.warn(`[运维查询] 随机背景获取失败，使用备用图片：${errorMessage(error)}`)
  }

  try {
    return await puppeteer.screenshot(`ops-query/${template}`, {
      ...data,
      backgroundImage,
      styles: fs.readFileSync(path.join(resourceRoot, `${template}.css`), "utf8"),
      tplFile: path.join(resourceRoot, `${template}.html`),
      saveId,
      imgType: "jpeg",
      quality: 92,
    })
  } catch (error) {
    logger.error(`[运维查询] 状态图片生成失败：${errorMessage(error)}`)
    return false
  }
}

function fileDataUri(file, contentType) {
  const bytes = fs.readFileSync(file)
  if (!bytes.length) throw new Error("备用背景图片为空")
  return `data:${contentType};base64,${bytes.toString("base64")}`
}

async function fetchBackgroundImage() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BACKGROUND_TIMEOUT_MS)
  timer.unref?.()

  try {
    const response = await fetch(BACKGROUND_URL, {
      redirect: "follow",
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const contentType = String(response.headers.get("content-type") || "").split(";")[0]
    if (!contentType.startsWith("image/"))
      throw new Error(`返回类型不是图片：${contentType || "未知"}`)
    const contentLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_BACKGROUND_BYTES) {
      throw new Error("背景图片超过 12MB")
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length) throw new Error("背景图片为空")
    if (bytes.length > MAX_BACKGROUND_BYTES) throw new Error("背景图片超过 12MB")
    return `data:${contentType};base64,${bytes.toString("base64")}`
  } finally {
    clearTimeout(timer)
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
