<script setup lang="ts">
import { onMounted } from 'vue'
import { ref, watch } from 'vue'
import { VFileUpload } from 'vuetify/labs/VFileUpload'

interface VideoState {
  currentTime: number
  isPaused: boolean
  clients: {
    id: string
    name: string
  }[]
}

const connected = ref(false)
const password = ref<string>('')
const clientName = ref<string>(localStorage.getItem('clientName') ?? '')

const video = ref<HTMLVideoElement | null>(null)

watch(clientName, (newName) => {
  localStorage.setItem('clientName', newName)
})

const filename = ref<string | null>(null)
const videoSrc = ref<string | null>(null)
const duration = ref<number | null>(null)

const handleFileInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    const fileURL = URL.createObjectURL(file)
    videoSrc.value = fileURL
    filename.value = file.name
  } else {
    videoSrc.value = null
  }
}

const isSecure = window.location.protocol === 'https:'

const videoState = ref<VideoState>({
  currentTime: 0,
  isPaused: true,
  clients: []
})

const currentClient = ref<string | null>(null)
let ignoreNextVideoEvent = false
const connecting = ref(false)
const websocket = ref<WebSocket | null>(null)
async function submit() {
  if (!password.value) {
    alert('Please enter a password')
    return
  }

  if (!videoSrc.value) {
    alert('Please select a video file')
    return
  }

  connecting.value = true
  const ws = new WebSocket(`ws${isSecure ? 's' : ''}://${window.location.host}/sync?password=${password.value}&clientName=${clientName.value}`)
  websocket.value = ws

  let didOpen = false

  ws.addEventListener('open', (event) => {
    didOpen = true
    connected.value = true

    ws.send(JSON.stringify({
      type: 'getState'
    }))
  })

  ws.addEventListener('error', (event) => {
    if (didOpen) {
      alert('Failed to connect to server. Please check the server address and try again.')
    } else {
      alert('Wrong password. Please try again.')
    }
    connecting.value = false
    ws.close()
  })

  ws.addEventListener('close', (event) => {
    connecting.value = false
  })

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data) as VideoState & {
      currentClient: string,
      info?: string
    }

    if (!video.value) {
      console.error('Video element not found')
      return
    }

    if (data.currentClient) {
      currentClient.value = data.currentClient
    }

    if (data.info) {
      showToast(data.info)
    }

    console.log('Time difference:', data.currentTime - video.value.currentTime)

    videoState.value.currentTime = data.currentTime
    videoState.value.isPaused = data.isPaused
    videoState.value.clients = data.clients

    if (Math.abs(data.currentTime - video.value.currentTime) > 0.5) {
      video.value.currentTime = data.currentTime
    }

    if (video.value.paused !== data.isPaused) {
      if (data.isPaused && !playSent) {
        playing.value = false
        ignoreNextVideoEvent = true
        video.value.pause()
        video.value.currentTime = data.currentTime
      } else if (!pauseSent) {
        playing.value = true
        ignoreNextVideoEvent = true
        video.value.play()
        video.value.currentTime = data.currentTime
      }
    }

    if (data.isPaused && pauseSent) {
      pauseSent = false
    } else if (!data.isPaused && playSent) {
      playSent = false
    }
  })
}

function progress() {
  websocket.value?.send(JSON.stringify({
    type: 'sync',
    currentTime: video.value?.currentTime,
  }))
  seekSliderValue.value = video.value?.currentTime ?? 0
}

let pauseSent = false
function pause() {
  if (ignoreNextVideoEvent) {
    ignoreNextVideoEvent = false
    return
  }

  playing.value = false
  pauseSent = true
  websocket.value?.send(JSON.stringify({
    type: 'pause',
    currentTime: video.value?.currentTime,
  }))
}

let playSent = false
function play() {
  if (ignoreNextVideoEvent) {
    ignoreNextVideoEvent = false
    return
  }

  playing.value = true
  playSent = true
  websocket.value?.send(JSON.stringify({
    type: 'play',
    currentTime: video.value?.currentTime,
  }))
}

const controlsVisible = ref(false)
let hideControlsTimeout: number | null = null
function showControls() {
  controlsVisible.value = true
  if (hideControlsTimeout) {
    clearTimeout(hideControlsTimeout)
  }
  hideControlsTimeout = setTimeout(() => {
    controlsVisible.value = false
  }, 3000)
}

const playing = ref(false)
const seekSliderValue = ref(0)
function seek(value: number) {
  if (video.value) {
    video.value.currentTime = value
    seekSliderValue.value = value
  }
}

const toasts = ref<string[]>([])
function showToast(message: string) {
  toasts.value.push(message)
  setTimeout(() => {
    toasts.value.shift()
  }, 3000)
}

const muted = ref(localStorage.getItem('muted') === 'true')
const volume = ref(localStorage.getItem('volume') ? parseInt(localStorage.getItem('volume') ?? '0') : 100)
function setVolume(value: number) {
  if (video.value) {
    video.value.volume = value / 100
    localStorage.setItem('volume', value.toFixed(0))
  }
}

function toggleMute() {
  if (video.value) {
    if (muted.value) {
      video.value.muted = false
      muted.value = false
      localStorage.setItem('muted', 'false')
    } else {
      video.value.muted = true
      muted.value = true
      localStorage.setItem('muted', 'true')
    }
  }
}

function toTimeString(seconds: number) {
  const durationDate = new Date((duration.value ?? 0) * 1000)
  const date = new Date(seconds * 1000)
  
  const showHours = durationDate.getUTCHours() > 0

  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  const secondsStr = date.getUTCSeconds().toString().padStart(2, '0')

  return showHours
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${secondsStr}`
    : `${minutes}:${secondsStr}`
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    document.documentElement.requestFullscreen()
  }
}

onMounted(() => {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.fullscreenElement) {
        document.exitFullscreen()
      }
    }

    if (event.key === ' ') {
      if (video.value) {
        if (video.value.paused) {
          video.value.play()
        } else {
          video.value.pause()
        }
      }
    }
  })
})
</script>

<template>
  <div class="app">
    <div class="toast">
      <VAlert
        v-for="(toast, index) in toasts"
        :key="index"
        variant="tonal"
        class="toast__alert"
      >
        {{ toast }}
      </VAlert>
    </div>

    <VCard v-if="!connected">
      <VForm @submit.prevent="submit">
        <VToolbar color="transparent" border="b">
          <VToolbarTitle>
            SyncWatch
          </VToolbarTitle>
        </VToolbar>

        <VCardText>
          <VFileUpload
            class="mb-4 pa-4"
            density="compact"
            :disabled="connecting"
            accept="video/*"
            :multiple="false"
            @change="handleFileInput"
          />
          <VTextField
            variant="outlined"
            :disabled="connecting"
            type="text"
            v-model="clientName"
            autocomplete="off"
            label="Enter your name (optional)"
            placeholder="Anonymous"
          />
          <VTextField
            variant="outlined"
            :disabled="connecting"
            type="password"
            autocomplete="current-password"
            v-model="password"
            label="Enter the password"
          />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn
            type="submit"
            color="primary"
            :disabled="connecting"
          >
            <template v-if="connecting">
              Connecting...
            </template>
            <template v-else>
              Connect
            </template>
          </VBtn>
        </VCardActions>
      </VForm>
    </VCard>

    <div
      :class="{
        player: true,
        'controls-visible': controlsVisible || !playing,
      }"
      v-else
      @mousemove="showControls"
    >
      <video
        ref="video"
        :src="videoSrc ?? ''"
        @timeupdate="progress"
        @loadedmetadata="() => {
          (duration = video?.duration ?? 0)

          if (video) {
            video.volume = volume / 100
            video.muted = muted
          }
        }"
        @pause="pause"
        @play="play"
        @volumechange="() => {
          if (video) {
            volume = video.volume * 100
          }
        }"
        @click="() => {
          if (video) {
            if (video.paused) {
              video.play()
            } else {
              video.pause()
            }
          }
        }"
      ></video>
      <div class="player__controls">
        <VBtn icon @click="() => {
          if (playing) {
            video?.pause()
          } else {
            video?.play()
          }
        }">
          <template v-if="playing">
            <VIcon>mdi-pause</VIcon>
          </template>
          <template v-else>
            <VIcon>mdi-play</VIcon>
          </template>
        </VBtn>
        <VBtn icon @click="() => {
          if (video) {
            video.currentTime -= 10
          }
        }">
          <VIcon>mdi-rewind-10</VIcon>
        </VBtn>
        <VBtn icon @click="() => {
          if (video) {
            video.currentTime += 10
          }
        }">
          <VIcon>mdi-fast-forward-10</VIcon>
        </VBtn>
        <VSlider
          :model-value="seekSliderValue"
          min="0"
          :max="duration ?? 0"
          step="1"
          hide-details
          thumb-label
          @update:model-value="seek"
        >
          <template #thumb-label>
            {{ toTimeString(seekSliderValue) }}
          </template>
        </VSlider>
        <div>
          <span>{{ toTimeString(seekSliderValue) }}</span>
          /
          <span>{{ toTimeString(duration ?? 0) }}</span>
        </div>
        <VBtn icon @click="toggleMute">
          <VIcon>{{ muted || volume === 0 ? 'mdi-volume-mute' : 'mdi-volume-high' }}</VIcon>
        </VBtn>
        <VSlider
          style="flex: 0 0 auto;"
          width="100px"
          :model-value="muted ? 0 : volume"
          min="0"
          max="100"
          step="1"
          hide-details
          thumb-label
          @update:model-value="setVolume"
        >
        </VSlider>
        <VBtn icon @click="toggleFullscreen">
          <VIcon>mdi-fullscreen</VIcon>
        </VBtn>
      </div>
      <div class="player__clients">
        <h2>
          Connected Clients
        </h2>

        <div
          v-for="client in videoState.clients"
          :key="client.id"
        >
          {{ client.name }}
          {{ currentClient === client.id ? ' (you)' : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
html, body, #app {
  height: 100%;
  margin: 0;
  background: #000;
  color: #efefef;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  .toast {
    pointer-events: none;

    position: fixed;
    top: 1rem;
    left: 1rem;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;

    .toast__alert {
      backdrop-filter: blur(1rem);
    }
  }

  .player {
    height: 100%;
    width: 100%;

    video {
      width: 100%;
      height: 100%;
      cursor: none;
    }

    &.controls-visible {
      video {
        cursor: default;
      }

      .player__controls {
        opacity: 1;
      }

      .player__clients {
        opacity: 1;
      }
    }

    &__controls {
      opacity: 0;
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;

      padding: 1rem;
    }

    &__clients {
      opacity: 0;
      position: absolute;
      top: 1rem;
      right: 1rem;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      text-align: right;
      pointer-events: none;

      h2 {
        font-size: 1.2rem;
      }
    }
  }
}
</style>
