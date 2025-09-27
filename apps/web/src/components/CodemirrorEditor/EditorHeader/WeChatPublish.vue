<script setup lang="ts">
import { Check, ExternalLink, Info, Loader2 } from 'lucide-vue-next'
import { useDisplayStore, useStore } from '@/stores'
import { toast } from '@/utils/toast'

const store = useStore()
const { output } = storeToRefs(store)
const displayStore = useDisplayStore()

const wechatForm = ref({
  title: ``,
  author: ``,
  digest: ``,
  contentSourceUrl: ``,
  // 封面图链接（用户可见/可输入）
  coverUrl: ``,
  // 内部使用的微信素材ID
  thumbMediaId: ``,
  needOpenComment: 1,
  onlyFansCanComment: 0,
})

const wechatPublishing = ref(false)
const wechatConfigDialogVisible = ref(false)
const wechatSuccessDialogVisible = ref(false)
const draftUrl = ref(``)

const disabledBtn = computed(() => {
  const content = output.value || ``
  return wechatPublishing.value || content.trim() === ``
})

const uploadingThumb = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
let coverUrlDebounceTimer: number | undefined

function extractTitleAndDesc() {
  try {
    // 优先从当前选中文章的标题中提取
    const currentPostTitleEl = document.querySelector(`a.bg-primary.text-primary-foreground.shadow span.line-clamp-1`) as HTMLElement | null
    let derivedTitle = currentPostTitleEl?.textContent?.trim() || ``

    // 如果没找到当前文章标题，再从 #output 的 h1-h6 中提取
    if (!derivedTitle) {
      const headingLevels = [1, 2, 3, 4, 5, 6]
      const headingElements = headingLevels.map((level) => {
        return document.querySelector(`#output h${level}`) as HTMLElement | null
      })
      const firstHeading = headingElements.find(el => el)
      derivedTitle = (firstHeading?.textContent || ``).trim()
    }

    const firstParagraph = document.querySelector(`#output p`) as HTMLElement | null
    const derivedDesc = (firstParagraph?.textContent || ``).trim()
    const firstImg = document.querySelector(`#output img`) as HTMLImageElement | null
    const derivedCover = firstImg?.src || ``

    if (!wechatForm.value.title)
      wechatForm.value.title = derivedTitle
    if (!wechatForm.value.digest)
      wechatForm.value.digest = derivedDesc
    if (!wechatForm.value.coverUrl && derivedCover)
      wechatForm.value.coverUrl = derivedCover
  }
  catch (e) {
    console.warn(`extractTitleAndDesc error`, e)
  }
}

watch(
  () => output.value,
  () => {
    // 当内容变化时，若未手填摘要，则尝试重新生成摘要
    if (!wechatForm.value.digest) {
      extractTitleAndDesc()
    }
  },
  { immediate: false },
)

// 封面链接变化时，清空已得的 media_id，等待重新上传
watch(
  () => wechatForm.value.coverUrl,
  (val) => {
    wechatForm.value.thumbMediaId = ``
    const url = (val || ``).trim()
    if (!url)
      return
    if (uploadingThumb.value)
      return
    if (coverUrlDebounceTimer)
      clearTimeout(coverUrlDebounceTimer)
    coverUrlDebounceTimer = window.setTimeout(() => {
      // 若期间用户又清空了，跳过
      if (!wechatForm.value.coverUrl?.trim())
        return
      uploadThumbIfNeeded().catch(() => {})
    }, 600)
  },
)

function convertCssVarsToInline(html: string): string {
  const cssVars: Record<string, string> = {
    '--md-primary-color': `#0F4C81`,
    '--foreground': `0, 0%, 0%`,
  }
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ``)
  html = html.replace(/--[a-z0-9-]+:[^;]+;/gi, ``)
  Object.keys(cssVars).forEach((varName) => {
    const regex = new RegExp(`var\\(${varName}\\)`, `g`)
    html = html.replace(regex, cssVars[varName])
  })
  html = html.replace(/hsl\(var\(--foreground\)\)/g, `hsl(0, 0%, 0%)`)
  html = html.replace(/;\s*;/g, `;`)
  html = html.replace(/\s+/g, ` `)
  html = html.replace(/"\s+/g, `"`)
  html = html.replace(/\s+"/g, `"`)
  return html
}

function openWechatConfig() {
  const content = output.value || ``
  if (content.trim() === ``) {
    toast.error(`请先填写内容`)
    return
  }
  // 打开弹窗后提示是否缺少配置
  extractTitleAndDesc()
  // 预取并上传封面图，获取 thumb_media_id
  uploadThumbIfNeeded().catch((err) => {
    console.warn(`uploadThumbIfNeeded error`, err)
  })
  wechatConfigDialogVisible.value = true
}

const mpConfigured = ref(true)
function isMpConfigured(): boolean {
  try {
    const mpConfigStr = localStorage.getItem(`mpConfig`)
    const cfg = mpConfigStr ? JSON.parse(mpConfigStr) : null
    return Boolean(cfg?.appID && cfg?.appsecret)
  }
  catch {
    return false
  }
}
function openMpConfigDialog() {
  localStorage.setItem(`imgHost`, `mp`)
  //   wechatConfigDialogVisible.value = false
  displayStore.toggleShowUploadImgDialog()
}
function recheckMpConfig() {
  mpConfigured.value = isMpConfigured()
  if (mpConfigured.value)
    toast.success(`已检测到公众号图床配置`)
  else
    toast.error(`仍未检测到配置，请完成后再试`)
}

watch(wechatConfigDialogVisible, (open) => {
  if (open) {
    mpConfigured.value = isMpConfigured()
    if (!mpConfigured.value)
      toast.error(`未检测到公众号图床配置，请先完成配置`)
  }
})

async function getWechatAccessToken(): Promise<string> {
  try {
    const mpConfig = localStorage.getItem(`mpConfig`)
    if (!mpConfig)
      throw new Error(`请先配置公众号图床信息`)

    const config = JSON.parse(mpConfig)
    const { appID, appsecret } = config
    if (!appID || !appsecret)
      throw new Error(`请先配置公众号 AppID 和 AppSecret`)

    const cachedData = localStorage.getItem(`mpToken:${appID}`)
    if (cachedData) {
      const token = JSON.parse(cachedData)
      if (token.expire && token.expire > new Date().getTime())
        return token.access_token
    }

    const tokenUrl = import.meta.env.DEV
      ? `/cgi-bin/token`
      : `https://api.weixin.qq.com/cgi-bin/token`

    const response = await fetch(`${tokenUrl}?grant_type=client_credential&appid=${appID}&secret=${appsecret}`)
    const result = await response.json()

    if (result.access_token) {
      const tokenInfo = {
        ...result,
        expire: new Date().getTime() + result.expires_in * 1000,
      }
      localStorage.setItem(`mpToken:${appID}`, JSON.stringify(tokenInfo))
      return result.access_token
    }
    else {
      throw new Error(`获取 access_token 失败：${result.errmsg || `未知错误`}`)
    }
  }
  catch (error) {
    console.error(`获取 access_token 失败:`, error)
    throw error
  }
}

async function publishToWechat() {
  wechatPublishing.value = true
  try {
    if (uploadingThumb.value) {
      toast.error(`封面上传中，请稍后再试`)
      return
    }
    if (!wechatForm.value.thumbMediaId) {
      toast.error(`请先提供封面并上传到微信后台`)
      return
    }
    const accessToken = await getWechatAccessToken()
    const processedContent = convertCssVarsToInline(output.value || ``)
    const articleTitle = wechatForm.value.title
    const articleDigest = wechatForm.value.digest

    const apiUrl = import.meta.env.DEV
      ? `/cgi-bin/draft/add?access_token=${accessToken}`
      : `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`

    const response = await fetch(apiUrl, {
      method: `POST`,
      headers: { 'Content-Type': `application/json` },
      body: JSON.stringify({
        articles: [
          {
            article_type: `news`,
            title: articleTitle,
            author: wechatForm.value.author || `作者名称`,
            digest: articleDigest,
            content_source_url: wechatForm.value.contentSourceUrl || ``,
            thumb_media_id: wechatForm.value.thumbMediaId || ``,
            need_open_comment: wechatForm.value.needOpenComment,
            only_fans_can_comment: wechatForm.value.onlyFansCanComment,
            content: processedContent,
          },
        ],
      }),
    })

    const result = await response.json()
    if (result.media_id) {
      const mpConfig = JSON.parse(localStorage.getItem(`mpConfig`) || `{}`)
      const appID = mpConfig.appID
      if (appID)
        draftUrl.value = `https://mp.weixin.qq.com/cgi-bin/home`

      toast.success(`发布成功！`)
      wechatConfigDialogVisible.value = false
      wechatSuccessDialogVisible.value = true
    }
    else {
      toast.error(`发布失败：${result.errmsg}`)
    }
  }
  catch (error) {
    console.error(`发布到微信公众号失败:`, error)
    if (error instanceof Error) {
      if (error.message.includes(`配置`))
        toast.error(error.message)
      else
        toast.error(`发布失败：${error.message}`)
    }
    else {
      toast.error(`发布失败，请检查网络连接`)
    }
  }
  finally {
    wechatPublishing.value = false
  }
}

// 从 #output 提取第一张图片并上传到公众号，返回 media_id
async function uploadThumbIfNeeded(): Promise<string | undefined> {
  try {
    if (wechatForm.value.thumbMediaId)
      return wechatForm.value.thumbMediaId

    const sourceUrl = (wechatForm.value.coverUrl || ``).trim()
    const imgSrc = sourceUrl || (document.querySelector(`#output img`) as HTMLImageElement | null)?.src || ``
    if (!imgSrc)
      return

    uploadingThumb.value = true
    const res = await fetch(imgSrc)
    const blob = await res.blob()

    // 使用原文件名或默认名
    const urlObj = new URL(imgSrc, window.location.href)
    const pathname = urlObj.pathname
    const originalName = pathname.split(`/`).pop() || `cover.jpg`
    const file = new File([blob], originalName, { type: blob.type || `image/jpeg` })

    const accessToken = await getWechatAccessToken()
    const formdata = new FormData()
    formdata.append(`media`, file, file.name)

    // 走函数代理，避免直连跨域与泄露
    const apiPath = `/cgi-bin/material/add_material?access_token=${accessToken}&type=image`
    const uploadResp = await fetch(apiPath, { method: `POST`, body: formdata })
    const json = await uploadResp.json()

    if (json.media_id) {
      wechatForm.value.thumbMediaId = json.media_id
      return json.media_id as string
    }

    // 若失败，给出提示但不阻断发布（允许用户手动填）
    if (json.errmsg)
      toast.error(`封面上传失败：${json.errmsg}`)
  }
  catch (e: any) {
    toast.error(`封面上传失败：${e?.message || e}`)
  }
  finally {
    uploadingThumb.value = false
  }
}

function pickLocalCoverImage() {
  if (uploadingThumb.value)
    return
  fileInputRef.value?.click()
}

async function onLocalCoverFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || !input.files.length)
    return
  const file = input.files[0]
  try {
    uploadingThumb.value = true
    const previewUrl = URL.createObjectURL(file)
    wechatForm.value.coverUrl = previewUrl

    const accessToken = await getWechatAccessToken()
    const formdata = new FormData()
    formdata.append(`media`, file, file.name)
    const apiPath = `/cgi-bin/material/add_material?access_token=${accessToken}&type=image`
    const uploadResp = await fetch(apiPath, { method: `POST`, body: formdata })
    const json = await uploadResp.json()
    if (json.media_id) {
      wechatForm.value.thumbMediaId = json.media_id
      toast.success(`封面已上传微信后台`)
    }
    else if (json.errmsg) {
      toast.error(`封面上传失败：${json.errmsg}`)
    }
  }
  catch (e: any) {
    toast.error(`封面上传失败：${e?.message || e}`)
  }
  finally {
    uploadingThumb.value = false
    // 重置 input 值以便可重复选择同一文件
    if (input)
      input.value = ``
  }
}
</script>

<template>
  <div>
    <Button
      variant="outline"
      :disabled="disabledBtn"
      @click="openWechatConfig"
    >
      {{ wechatPublishing ? '发布中...' : '发布到公众号' }}
    </Button>

    <Dialog v-model:open="wechatConfigDialogVisible">
      <DialogContent class="z-[50]">
        <DialogHeader>
          <DialogTitle>发布到微信公众号</DialogTitle>
        </DialogHeader>

        <Alert v-if="!mpConfigured">
          <Info class="h-4 w-4" />
          <AlertTitle>需要先配置公众号图床</AlertTitle>
          <AlertDescription>
            请先完成 appID 与 appsecret 的配置。
            <div class="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" @click="openMpConfigDialog">
                打开配置
              </Button>
              <Button size="sm" variant="ghost" @click="recheckMpConfig">
                我已配置，重新检测
              </Button>
            </div>
          </AlertDescription>
        </Alert>

        <div class="w-full flex items-center gap-4">
          <Label for="wechat-title" class="w-16 text-end">
            标题
          </Label>
          <Input id="wechat-title" v-model="wechatForm.title" placeholder="文章标题" />
        </div>

        <div class="w-full flex items-center gap-4">
          <Label for="wechat-author" class="w-16 text-end">
            作者
          </Label>
          <Input id="wechat-author" v-model="wechatForm.author" placeholder="作者名称" />
        </div>

        <div class="w-full flex items-start gap-4">
          <Label for="wechat-digest" class="w-16 text-end">
            摘要
          </Label>
          <Textarea id="wechat-digest" v-model="wechatForm.digest" placeholder="文章摘要内容" />
        </div>

        <div class="w-full flex items-center gap-4">
          <Label for="wechat-cover" class="w-16 text-end">
            封面链接
          </Label>
          <div class="flex-1 flex items-center gap-2">
            <Input
              id="wechat-cover"
              v-model="wechatForm.coverUrl"
              :disabled="uploadingThumb"
              placeholder="https://..."
            />
            <span class="text-sm text-muted-foreground select-none inline-flex items-center gap-1">
              <Loader2 v-if="uploadingThumb" class="h-4 w-4 animate-spin" />
              <Check v-else-if="wechatForm.thumbMediaId" class="h-4 w-4 text-green-500" />
              <span class="text-xs">
                {{ uploadingThumb ? '自动上传中…' : (wechatForm.thumbMediaId ? '已上传微信后台' : '将自动上传到微信后台') }}
              </span>
            </span>
          </div>
        </div>

        <div v-if="!wechatForm.coverUrl" class="w-full flex items-center gap-4">
          <div class="w-16 text-end" />
          <div class="flex-1 flex items-center gap-2">
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onLocalCoverFileChange"
            >
            <Button variant="outline" :disabled="uploadingThumb" @click="pickLocalCoverImage">
              {{ uploadingThumb ? '上传中…' : '上传图片' }}
            </Button>
            <span class="text-xs text-muted-foreground">未提取到封面，请上传本地图片或在上方输入图片地址</span>
          </div>
        </div>

        <div class="w-full flex items-center gap-4">
          <Label for="wechat-url" class="w-18 text-end">
            原文链接
          </Label>
          <Input id="wechat-url" v-model="wechatForm.contentSourceUrl" placeholder="" />
        </div>

        <div class="w-full flex items-center gap-4">
          <Label class="w-16 text-end">
            评论设置
          </Label>
          <div class="flex gap-4">
            <label class="flex items-center gap-2">
              <input v-model="wechatForm.needOpenComment" type="checkbox" :true-value="1" :false-value="0">
              <span class="text-sm">开启评论</span>
            </label>
            <label class="flex items-center gap-2">
              <input v-model="wechatForm.onlyFansCanComment" type="checkbox" :true-value="1" :false-value="0">
              <span class="text-sm">仅粉丝可评论</span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="wechatConfigDialogVisible = false">
            取 消
          </Button>
          <Button :disabled="wechatPublishing || !mpConfigured" @click="publishToWechat">
            {{ wechatPublishing ? '发布中...' : '确 定' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="wechatSuccessDialogVisible">
      <DialogContent class="z-[1000]">
        <DialogHeader>
          <DialogTitle>发布成功</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <div class="text-center">
            <Check class="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p class="text-lg font-medium">
              文章已成功发布到微信公众号
            </p>
            <p class="text-sm text-gray-600 mt-2">
              <a
                href="https://mp.weixin.qq.com/cgi-bin/home"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                打开微信公众号管理后台
                <ExternalLink class="h-4 w-4 opacity-90" />
              </a>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
