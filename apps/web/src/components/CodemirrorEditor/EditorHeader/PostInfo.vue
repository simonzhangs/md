<script setup lang="ts">
import type { Post, PostAccount } from '@md/shared/types'
import { Check, Info } from 'lucide-vue-next'
import { CheckboxIndicator, CheckboxRoot, Primitive } from 'radix-vue'
import { useStore } from '@/stores'
import { toast } from '@/utils/toast'

const store = useStore()
const { output, editor } = storeToRefs(store)

const dialogVisible = ref(false)
const extensionInstalled = ref(false)
const allAccounts = ref<PostAccount[]>([])
const postTaskDialogVisible = ref(false)

const form = ref<Post>({
  title: ``,
  desc: ``,
  thumb: ``,
  content: ``,
  markdown: ``,
  accounts: [] as PostAccount[],
})

// 微信公众号相关
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

const allowPost = computed(() => extensionInstalled.value && form.value.accounts.some(a => a.checked))

async function prePost() {
  if (extensionInstalled.value && allAccounts.value.length === 0) {
    await getAccounts()
  }

  let auto: Post = {
    thumb: ``,
    title: ``,
    desc: ``,
    content: ``,
    markdown: ``,
    accounts: [],
  }
  const accounts = allAccounts.value.filter(a => ![`ipfs`].includes(a.type))
  try {
    auto = {
      thumb: document.querySelector<HTMLImageElement>(`#output img`)?.src ?? ``,
      title: [1, 2, 3, 4, 5, 6]
        .map(h => document.querySelector(`#output h${h}`)!)
        .find(h => h)
        ?.textContent ?? ``,
      desc: document.querySelector(`#output p`)?.textContent?.trim() ?? ``,
      content: output.value,
      markdown: editor.value?.getValue() ?? ``,
      accounts,
    }
  }
  catch (error) {
    console.log(`error`, error)
  }
  finally {
    form.value = {
      ...auto,
    }

    // 同时填充微信公众号表单的默认值
    wechatForm.value.digest = auto.desc
  }
}

declare global {
  interface Window {
    syncPost: (data: { thumb: string, title: string, desc: string, content: string }) => void
    $syncer: any
  }
}

async function getAccounts(): Promise<void> {
  return new Promise((resolve) => {
    window.$syncer?.getAccounts((resp: PostAccount[]) => {
      allAccounts.value = resp.map(a => ({ ...a, checked: true }))
      resolve()
    })
  })
}

function post() {
  form.value.accounts = form.value.accounts.filter(a => a.checked)
  postTaskDialogVisible.value = true
  dialogVisible.value = false
}

// CSS变量转换为内联样式的函数
function convertCssVarsToInline(html: string): string {
  // 定义CSS变量到实际值的映射
  const cssVars: Record<string, string> = {
    '--md-primary-color': `#0F4C81`,
    '--foreground': `0, 0%, 0%`, // 默认黑色
  }

  // 移除<style>标签及其内容
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ``)

  // 移除CSS变量定义
  html = html.replace(/--[a-z0-9-]+:[^;]+;/gi, ``)

  // 替换CSS变量引用
  Object.keys(cssVars).forEach((varName) => {
    const regex = new RegExp(`var\\(${varName}\\)`, `g`)
    html = html.replace(regex, cssVars[varName])
  })

  // 处理hsl(var(--foreground))的情况
  html = html.replace(/hsl\(var\(--foreground\)\)/g, `hsl(0, 0%, 0%)`)

  // 清理多余的分号和空格
  html = html.replace(/;\s*;/g, `;`)
  html = html.replace(/\s+/g, ` `)
  html = html.replace(/"\s+/g, `"`)
  html = html.replace(/\s+"/g, `"`)

  return html
}

// 打开微信公众号配置对话框
function openWechatConfig() {
  if (!form.value.title || !form.value.content) {
    toast.error(`请先填写标题和内容`)
    return
  }

  // 自动填充一些默认值
  wechatForm.value.digest = form.value.desc
  wechatConfigDialogVisible.value = true
}

// 获取微信公众号 access_token
async function getWechatAccessToken(): Promise<string> {
  try {
    // 从 localStorage 获取公众号配置
    const mpConfig = localStorage.getItem(`mpConfig`)
    if (!mpConfig) {
      throw new Error(`请先配置公众号图床信息`)
    }

    const config = JSON.parse(mpConfig)
    const { appID, appsecret } = config

    if (!appID || !appsecret) {
      throw new Error(`请先配置公众号 AppID 和 AppSecret`)
    }

    // 检查本地缓存的 token
    const cachedData = localStorage.getItem(`mpToken:${appID}`)
    if (cachedData) {
      const token = JSON.parse(cachedData)
      if (token.expire && token.expire > new Date().getTime()) {
        return token.access_token
      }
    }

    // 获取新的 access_token
    const tokenUrl = import.meta.env.DEV
      ? `/cgi-bin/token` // 开发环境使用代理
      : `https://api.weixin.qq.com/cgi-bin/token` // 生产环境直接调用

    const response = await fetch(`${tokenUrl}?grant_type=client_credential&appid=${appID}&secret=${appsecret}`)
    const result = await response.json()

    if (result.access_token) {
      // 缓存 token
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

// 发布到微信公众号后台
async function publishToWechat() {
  wechatPublishing.value = true

  try {
    // 动态获取 access_token
    const accessToken = await getWechatAccessToken()

    // 处理内容，将CSS变量转换为内联样式
    const processedContent = convertCssVarsToInline(form.value.content)

    // 根据环境选择 API 地址
    const apiUrl = import.meta.env.DEV
      ? `/cgi-bin/draft/add?access_token=${accessToken}` // 开发环境使用代理
      : `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}` // 生产环境直接调用

    const response = await fetch(apiUrl, {
      method: `POST`,
      headers: {
        'Content-Type': `application/json`,
      },
      body: JSON.stringify({
        articles: [
          {
            article_type: `news`,
            title: form.value.title,
            author: wechatForm.value.author || `作者名称`,
            digest: wechatForm.value.digest || form.value.desc,
            content_source_url: wechatForm.value.contentSourceUrl || `https://baidu.com`,
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
      toast.success(`发布成功！`)
      wechatConfigDialogVisible.value = false
    }
    else {
      toast.error(`发布失败：${result.errmsg}`)
    }
  }
  catch (error) {
    console.error(`发布到微信公众号失败:`, error)
    if (error instanceof Error) {
      if (error.message.includes(`配置`)) {
        toast.error(error.message)
      }
      else {
        toast.error(`发布失败：${error.message}`)
      }
    }
    else {
      toast.error(`发布失败，请检查网络连接`)
    }
  }
  finally {
    wechatPublishing.value = false
  }
}

function onUpdate(val: boolean) {
  if (!val) {
    dialogVisible.value = false
  }
}

function checkExtension() {
  if (window.$syncer !== undefined) {
    extensionInstalled.value = true
    return
  }

  // 如果插件还没加载，5秒内每 500ms 检查一次
  let count = 0
  const timer = setInterval(async () => {
    if (window.$syncer !== undefined) {
      extensionInstalled.value = true
      await getAccounts()
      clearInterval(timer)
      return
    }

    count++
    if (count > 10) { // 5秒后还是没有检测到，就停止检查
      clearInterval(timer)
    }
  }, 500)
}

onBeforeMount(() => {
  checkExtension()
})
</script>

<template>
  <Dialog v-model:open="dialogVisible" @update:open="onUpdate">
    <DialogTrigger>
      <Button v-if="!store.isMobile" variant="outline" @click="prePost">
        发布
      </Button>
    </DialogTrigger>

    <!-- 微信公众号发布按钮 -->
    <Button
      v-if="!store.isMobile"
      variant="outline"
      :disabled="wechatPublishing"
      class="ml-2"
      @click="openWechatConfig"
    >
      {{ wechatPublishing ? '发布中...' : '发布到公众号' }}
    </Button>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>发布</DialogTitle>
      </DialogHeader>
      <Alert>
        <Info class="h-4 w-4" />
        <AlertTitle>提示</AlertTitle>
        <AlertDescription>
          此功能由第三方浏览器插件支持，本平台不保证安全性及同步准确度。
        </AlertDescription>
      </Alert>

      <Alert v-if="!extensionInstalled">
        <Info class="h-4 w-4" />
        <AlertTitle>未检测到插件</AlertTitle>
        <AlertDescription>
          请安装
          <Primitive
            as="a" class="text-blue-500" href="https://www.wechatsync.com/?utm_source=syncicon#install"
            target="_blank"
          >
            文章同步助手
          </Primitive>
          插件
        </AlertDescription>
      </Alert>

      <div class="w-full flex items-center gap-4">
        <Label for="thumb" class="w-10 text-end">
          封面
        </Label>
        <Input id="thumb" v-model="form.thumb" placeholder="自动提取第一张图" />
      </div>
      <div class="w-full flex items-center gap-4">
        <Label for="title" class="w-10 text-end">
          标题
        </Label>
        <Input id="title" v-model="form.title" placeholder="自动提取第一个标题" />
      </div>
      <div class="w-full flex items-start gap-4">
        <Label for="desc" class="w-10 text-end">
          描述
        </Label>
        <Textarea id="desc" v-model="form.desc" placeholder="自动提取第一个段落" />
      </div>

      <div class="w-full flex items-start gap-4">
        <Label class="w-10 text-end">
          账号
        </Label>
        <div class="flex flex-1 flex-col gap-2">
          <div v-for="account in form.accounts" :key="account.uid + account.displayName" class="flex items-center gap-2">
            <label class="flex flex-row items-center gap-4">
              <CheckboxRoot
                v-model:checked="account.checked"
                class="bg-background hover:bg-muted h-[25px] w-[25px] flex appearance-none items-center justify-center border border-gray-200 rounded-[4px] outline-none"
              >
                <CheckboxIndicator>
                  <Check v-if="account.checked" class="h-4 w-4" />
                </CheckboxIndicator>
              </CheckboxRoot>
              <span class="flex items-center gap-2 text-sm">
                <img
                  :src="account.icon"
                  alt=""
                  class="inline-block h-[20px] w-[20px]"
                >
                {{ account.title }} - {{ account.displayName ?? account.home }}
              </span>
            </label>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="dialogVisible = false">
          取 消
        </Button>
        <Button :disabled="!allowPost" @click="post">
          确 定
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <PostTaskDialog v-model:open="postTaskDialogVisible" :post="form" />

  <!-- 微信公众号配置对话框 -->
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
        <Input id="wechat-url" v-model="wechatForm.contentSourceUrl" placeholder="https://baidu.com" />
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
</template>
