<script setup lang="ts">
import { Check, ExternalLink } from 'lucide-vue-next'
import { useStore } from '@/stores'
import { toast } from '@/utils/toast'

const store = useStore()
const { output } = storeToRefs(store)

const wechatForm = ref({
  author: ``,
  digest: ``,
  contentSourceUrl: ``,
  thumbMediaId: ``,
  needOpenComment: 1,
  onlyFansCanComment: 0,
})

const wechatPublishing = ref(false)
const wechatConfigDialogVisible = ref(false)
const wechatSuccessDialogVisible = ref(false)
const draftUrl = ref(``)

// 从页面内容提取的标题与摘要（当未通过 props 传入时使用）
const autoTitle = ref(``)
const autoDesc = ref(``)

const disabledBtn = computed(() => {
  const content = output.value || ``
  return wechatPublishing.value || content.trim() === ``
})

function extractTitleAndDesc() {
  try {
    const headingLevels = [1, 2, 3, 4, 5, 6]
    const headingElements = headingLevels.map((level) => {
      return document.querySelector(`#output h${level}`) as HTMLElement | null
    })
    const firstHeading = headingElements.find(el => el)
    const derivedTitle = (firstHeading?.textContent || ``).trim()

    const firstParagraph = document.querySelector(`#output p`) as HTMLElement | null
    const derivedDesc = (firstParagraph?.textContent || ``).trim()

    autoTitle.value = derivedTitle
    autoDesc.value = derivedDesc
    if (!wechatForm.value.digest)
      wechatForm.value.digest = derivedDesc
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
  extractTitleAndDesc()
  if (!wechatForm.value.digest)
    wechatForm.value.digest = autoDesc.value || ``
  wechatConfigDialogVisible.value = true
}

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
    const accessToken = await getWechatAccessToken()
    const processedContent = convertCssVarsToInline(output.value || ``)
    const articleTitle = autoTitle.value
    const articleDigest = wechatForm.value.digest || autoDesc.value

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
            thumb_media_id: wechatForm.value.thumbMediaId || `jYWa8NiBsNmSMAhykezVJZUmjMTYS-AE9DWvBIl0qvBtqY5wJbZqDs-8gzSiyCqA`,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发布到微信公众号</DialogTitle>
        </DialogHeader>

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
          <Label for="wechat-url" class="w-16 text-end">
            原文链接
          </Label>
          <Input id="wechat-url" v-model="wechatForm.contentSourceUrl" placeholder="" />
        </div>

        <div class="w-full flex items-center gap-4">
          <Label for="wechat-thumb" class="w-16 text-end">
            封面ID
          </Label>
          <Input id="wechat-thumb" v-model="wechatForm.thumbMediaId" placeholder="thumb_media_id" />
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
          <Button :disabled="wechatPublishing" @click="publishToWechat">
            {{ wechatPublishing ? '发布中...' : '确 定' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="wechatSuccessDialogVisible">
      <DialogContent>
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
