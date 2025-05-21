<script setup lang="ts">
import { onMounted } from 'vue'
import { watchEffect } from 'vue'
import { ref, watch } from 'vue'
import { VFileUpload } from 'vuetify/labs/VFileUpload'

interface VideoState {
  currentTime: number
  isPaused: boolean
  clients: {
    id: string
    name: string
  }[],
  roomId: string
}

const connected = ref(false)
const roomCode = ref<string>(localStorage.getItem('roomCode') ?? '')
watchEffect(() => {
  roomCode.value = roomCode.value.toUpperCase()
  localStorage.setItem('roomCode', roomCode.value)
})

const clientName = ref<string>(localStorage.getItem('clientName') ?? '')
watchEffect(() => {
  localStorage.setItem('clientName', clientName.value)
})

const video = ref<HTMLVideoElement | null>(null)


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

const handleFileInputPlayer = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    const fileURL = URL.createObjectURL(file)
    videoSrc.value = fileURL
    filename.value = file.name

    if (!video.value?.paused) {
      pause()
    }
  }
}

const isSecure = window.location.protocol === 'https:'

const videoState = ref<VideoState>({
  currentTime: 0,
  isPaused: true,
  clients: [],
  roomId: '',
})

const currentClient = ref<string | null>(null)
let ignoreNextVideoEvent = false
const connecting = ref(false)
const websocket = ref<WebSocket | null>(null)
async function connectToRoom(create: boolean = false) {
  if (!roomCode.value && !create) {
    alert('Please enter a room code')
    return
  }

  if (!videoSrc.value) {
    alert('Please select a video file')
    return
  }

  connecting.value = true
  const ws = new WebSocket(create
    ? `ws${isSecure ? 's' : ''}://${window.location.host}/create?clientName=${clientName.value}`
    : `ws${isSecure ? 's' : ''}://${window.location.host}/sync?room=${roomCode.value}&clientName=${clientName.value}`)
  websocket.value = ws

  let didOpen = false

  ws.addEventListener('open', () => {
    didOpen = true
    connected.value = true

    ws.send(JSON.stringify({
      type: 'getState'
    }))
  })

  ws.addEventListener('error', () => {
    if (didOpen) {
      alert('Failed to connect to server. Please try again later.')
    } else {
      alert('Room not found. Please check the room code and try again.')
    }
    connecting.value = false
    ws.close()
  })

  ws.addEventListener('close', () => {
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
    videoState.value.roomId = data.roomId

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
  showPlayPauseOverlay()
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
  showPlayPauseOverlay()
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
    muted.value = false
    video.value.muted = false
    video.value.volume = value / 100
    localStorage.setItem('volume', value.toFixed(0))
    localStorage.setItem('muted', 'false')
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

function leaveRoom() {
  localStorage.removeItem('roomCode')
  location.reload()
}

let pressedPlayPauseFullscreenBefore = false
let pressedPlayPauseFullscreenBeforeTimeout: number | null = null
function playPauseFullscreen() {
  if (pressedPlayPauseFullscreenBefore) {
    pressedPlayPauseFullscreenBeforeTimeout && clearTimeout(pressedPlayPauseFullscreenBeforeTimeout)
    pressedPlayPauseFullscreenBeforeTimeout = null
    pressedPlayPauseFullscreenBefore = false

    toggleFullscreen()

    return
  }

  pressedPlayPauseFullscreenBefore = true

  pressedPlayPauseFullscreenBeforeTimeout = setTimeout(() => {
    if (video.value) {
      if (video.value.paused) {
        video.value.play()
      } else {
        video.value.pause()
      }
    }

    pressedPlayPauseFullscreenBefore = false
    pressedPlayPauseFullscreenBeforeTimeout = null
  }, 200)
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

    if (event.key === 'm') {
      toggleMute()
    }

    if (event.key === 'f') {
      toggleFullscreen()
    }
  })
})

const playPauseOverlayVisible = ref(false)
function showPlayPauseOverlay() {
  playPauseOverlayVisible.value = true
  setTimeout(() => {
    playPauseOverlayVisible.value = false
  }, 100)
}
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

    <VCard v-if="!connected" rounded="lg" border class="form">
      <VToolbar color="transparent" border="b">
        <VToolbarTitle class="title">
          SyncWatch
        </VToolbarTitle>
      </VToolbar>

      <VCardText>
        <p>
          Watch video files with your friends in sync.
        </p>
        <VFileUpload
          class="mb-4 pa-4 file-upload"
          density="compact"
          :disabled="connecting"
          accept="video/*"
          :multiple="false"
          @change="handleFileInput"
          icon="mdi-play-box-outline"
          title="Select a video file"
        />
        <p>
          Everyone in the room will need to select the same video file.
        </p>
        <VTextField
          class="mt-8"
          variant="outlined"
          :disabled="connecting"
          v-model="clientName"
          autocomplete="off"
          label="Enter your name (optional)"
          placeholder="Anonymous"
        />
        <VLabel
          class="mt-4"
        >
          Enter a room code to join an existing room
        </VLabel>
        <div class="d-flex align-center justify-space-between" style="gap: 1rem;">
          <VOtpInput
            variant="outlined"
            :disabled="connecting"
            v-model="roomCode"
            type="text"
            :length="4"
          />
          <VBtn
            variant="tonal"
            @click="connectToRoom()"
            color="primary"
            :disabled="connecting"
            :loading="connecting"
          >
            Join <VIcon>mdi-arrow-right</VIcon>
          </VBtn>
        </div>
        <VBtn
          class="mt-4"
          width="100%"
          variant="tonal"
          @click="connectToRoom(true)"
          color="primary"
          :disabled="connecting"
          :loading="connecting"
        >
          Create Room
        </VBtn>
      </VCardText>
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
        @click="playPauseFullscreen"
      ></video>
      <div :class="{
        'player__play-pause-overlay': true,
        'player__play-pause-overlay--visible': playPauseOverlayVisible,
      }">
        <VIcon>
          <template v-if="playing">
            mdi-play
          </template>
          <template v-else>
            mdi-pause
          </template>
        </VIcon>
      </div>
      <div class="player__controls">
        <VBtn variant="tonal" icon @click="() => {
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

          <VTooltip activator="parent" location="top">
            <span>{{ playing ? 'Pause' : 'Play' }}</span>
          </VTooltip>
        </VBtn>
        <VBtn variant="tonal" icon @click="() => {
          if (video) {
            video.currentTime -= 10
          }
        }">
          <VIcon>mdi-rewind-10</VIcon>

          <VTooltip activator="parent" location="top">
            <span>Rewind 10 seconds</span>
          </VTooltip>
        </VBtn>
        <VBtn variant="tonal" icon @click="() => {
          if (video) {
            video.currentTime += 10
          }
        }">
          <VIcon>mdi-fast-forward-10</VIcon>

          <VTooltip activator="parent" location="top">
            <span>Skip 10 seconds</span>
          </VTooltip>
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
        <VBtn variant="tonal" icon @click="toggleMute">
          <VIcon>{{ muted || volume === 0 ? 'mdi-volume-mute' : 'mdi-volume-high' }}</VIcon>

          <VTooltip activator="parent" location="top">
            <span>{{ muted || volume === 0 ? 'Unmute' : 'Mute' }}</span>
          </VTooltip>
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
        <VBtn variant="tonal" icon @click="toggleFullscreen">
          <VIcon>mdi-fullscreen</VIcon>

          <VTooltip activator="parent" location="top">
            <span>Fullscreen</span>
          </VTooltip>
        </VBtn>
      </div>
      <div class="player__info">
        <VFileUpload
          class="file-upload pa-2"
          density="compact"
          icon="mdi-play-box-outline"
          :title="`Select a video file: ${filename}`"
          accept="video/*"
          :multiple="false"
          @change="handleFileInputPlayer"
        />
        <VBtn variant="tonal">
          Leave Room

          <VMenu activator="parent" width="300">
            <template #default="{ isActive }">
              <VCard>
                <VCardText>
                  Are you sure you want to leave the room?
                </VCardText>
                <VCardActions>
                  <VBtn @click="leaveRoom" color="red">Leave</VBtn>
                  <VBtn @click="isActive.value = false">Cancel</VBtn>
                </VCardActions>
              </VCard>
            </template>
          </VMenu>
        </VBtn>

        <VDivider class="my-4" style="width: 10rem;" />

        <h2>
          Room Code: {{ videoState.roomId }}
        </h2>

        <VDivider class="my-4" style="width: 10rem;" />

        <h2>
          Connected
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
@import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap');
@font-face {
  font-family: 'C Web';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/CWEBS.TTF') format('truetype');
}

html, body, #app {
  height: 100%;
  margin: 0;
  background: #000;
  color: #efefef;
  font-family: 'Poppins', sans-serif;
}

.title {
  font-family: 'C Web', sans-serif;
  font-size: 3.5rem;
  font-weight: 400;
  transform: translateY(-.1em);
  padding: 1rem 0;
  width: fit-content;

  text-shadow: 0 0 1rem #fff5;

  .v-toolbar-title__placeholder {
    overflow: visible !important;
  }
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.v-overlay__scrim {
  background: #000a;
  backdrop-filter: blur(0.5rem);
  opacity: 1;
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
      backdrop-filter: blur(0.5rem);
      background: #000a;
    }
  }

  .form {
    position: relative;
    width: min-content;
    overflow: visible;
    z-index: 1;
    background: #111;

    p {
      margin-bottom: 1rem;
    }

    .file-upload {
      background: transparent;
    }
  }

  .file-upload {
    * {
      font-size: 1.5rem;
      font-weight: 400;
    }
  }
  
  .player {
    height: 100%;
    width: 100%;
    background: #000;

    video {
      width: 100%;
      height: 100%;
      cursor: none;
    }

    &__play-pause-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 1.5rem;
      background: #333a;
      border-radius: 50%;
      color: #fff;
      font-size: 2rem;
      backdrop-filter: blur(0.5rem);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s 0.3s ease-in-out;
      
      &--visible {
        transition: none;
        opacity: 1;
        pointer-events: all;
        cursor: pointer;
      }
    }

    .file-upload {
      * {
        font-size: 1rem;
      }
    }
    .file-upload + .v-file-upload-items {
      display: none;
    }

    &.controls-visible {
      video {
        cursor: default;
      }

      .player__controls {
        opacity: 1;
        transition: opacity 0.2s;
      }

      .player__info {
        opacity: 1;
        transition: opacity 0.2s;
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
      z-index: 1;
      transition: opacity 1s;

      padding: 1rem;

      & > .v-btn {
        background: #000a;
        pointer-events: all;
        backdrop-filter: blur(0.5rem);
      }

      &::before {
        content: '';
        position: absolute;
        top: -150%;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(to top, #000a, #0000);
        z-index: -1;
        pointer-events: none;
      }
    }

    &__info {
      opacity: 0;
      transition: opacity 1s;
      position: absolute;
      top: 1rem;
      right: 1rem;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.5rem;
      text-align: right;
      pointer-events: none;

      & > .v-btn {
        background: #000a;
        pointer-events: all;
        backdrop-filter: blur(0.5rem);
      }

      h2 {
        font-size: 1.2rem;
        pointer-events: all;
        width: fit-content;
        margin-left: auto;
      }

      & > div {
        width: fit-content;
        margin-left: auto;
        pointer-events: all;
      }

      & > :not(.v-divider, .v-btn, .v-file-upload) {
        text-shadow: 0 .2rem 0.5rem #000;
      }
    }
  }
}
</style>
