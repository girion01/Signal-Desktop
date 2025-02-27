// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ThunkAction } from 'redux-thunk';
import type { ReadonlyDeep } from 'type-fest';
import type { BoundActionCreatorsMapObject } from '../../hooks/useBoundActions';
import { useBoundActions } from '../../hooks/useBoundActions';

import type { StateType as RootStateType } from '../reducer';
import { setVoiceNotePlaybackRate } from './conversations';
import { extractVoiceNoteForPlayback } from '../selectors/audioPlayer';
import type {
  VoiceNoteAndConsecutiveForPlayback,
  VoiceNoteForPlayback,
} from '../selectors/audioPlayer';

import type {
  MessagesAddedActionType,
  MessageDeletedActionType,
  MessageChangedActionType,
  SelectedConversationChangedActionType,
  ConversationChangedActionType,
} from './conversations';
import * as log from '../../logging/log';
import { isAudio } from '../../types/Attachment';
import { getAttachmentUrlForPath } from '../selectors/message';
import { assertDev } from '../../util/assert';

// State

export type AudioPlayerContent = ReadonlyDeep<{
  conversationId: string;
  context: string;
  current: VoiceNoteForPlayback;
  queue: ReadonlyArray<VoiceNoteForPlayback>;
  nextMessageTimestamp: number | undefined;
  // playing because it followed a message
  // false on the first of a consecutive group
  isConsecutive: boolean;
  ourConversationId: string | undefined;
}>;

export type ActiveAudioPlayerStateType = ReadonlyDeep<{
  playing: boolean;
  currentTime: number;
  playbackRate: number;
  duration: number | undefined; // never zero or NaN
  startPosition: number;
  content: AudioPlayerContent;
}>;

export type AudioPlayerStateType = ReadonlyDeep<{
  active: ActiveAudioPlayerStateType | undefined;
}>;

// Actions

export type SetMessageAudioAction = ReadonlyDeep<{
  type: 'audioPlayer/SET_MESSAGE_AUDIO';
  payload:
    | {
        conversationId: string;
        context: string;
        current: VoiceNoteForPlayback;
        queue: ReadonlyArray<VoiceNoteForPlayback>;
        isConsecutive: boolean;
        // timestamp of the message following the last one in the queue
        nextMessageTimestamp: number | undefined;
        ourConversationId: string | undefined;
        startPosition: number;
        playbackRate: number;
      }
    | undefined;
}>;

type SetPlaybackRate = ReadonlyDeep<{
  type: 'audioPlayer/SET_PLAYBACK_RATE';
  payload: number;
}>;

export type SetIsPlayingAction = ReadonlyDeep<{
  type: 'audioPlayer/SET_IS_PLAYING';
  payload: boolean;
}>;

type CurrentTimeUpdated = ReadonlyDeep<{
  type: 'audioPlayer/CURRENT_TIME_UPDATED';
  payload: number;
}>;

type SetPosition = ReadonlyDeep<{
  type: 'audioPlayer/SET_POSITION';
  payload: number;
}>;

type MessageAudioEnded = ReadonlyDeep<{
  type: 'audioPlayer/MESSAGE_AUDIO_ENDED';
}>;

type DurationChanged = ReadonlyDeep<{
  type: 'audioPlayer/DURATION_CHANGED';
  payload: number | undefined;
}>;

type AudioPlayerActionType = ReadonlyDeep<
  | SetMessageAudioAction
  | SetIsPlayingAction
  | SetPlaybackRate
  | MessageAudioEnded
  | CurrentTimeUpdated
  | DurationChanged
  | SetPosition
>;

// Action Creators

export const actions = {
  loadMessageAudio,
  setPlaybackRate,
  currentTimeUpdated,
  durationChanged,
  setIsPlaying,
  setPosition,
  pauseVoiceNotePlayer,
  unloadMessageAudio,
  messageAudioEnded,
};

function messageAudioEnded(): MessageAudioEnded {
  return {
    type: 'audioPlayer/MESSAGE_AUDIO_ENDED',
  };
}

function durationChanged(value: number | undefined): DurationChanged {
  assertDev(
    !Number.isNaN(value) && (value === undefined || value > 0),
    `Duration must be > 0 if defined, got ${value}`
  );
  return {
    type: 'audioPlayer/DURATION_CHANGED',
    payload: value,
  };
}

export const useAudioPlayerActions = (): BoundActionCreatorsMapObject<
  typeof actions
> => useBoundActions(actions);

function currentTimeUpdated(value: number): CurrentTimeUpdated {
  return {
    type: 'audioPlayer/CURRENT_TIME_UPDATED',
    payload: value,
  };
}

function setPosition(positionAsRatio: number): SetPosition {
  return {
    type: 'audioPlayer/SET_POSITION',
    payload: positionAsRatio,
  };
}

function setPlaybackRate(
  rate: number
): ThunkAction<
  void,
  RootStateType,
  unknown,
  SetPlaybackRate | ConversationChangedActionType
> {
  return (dispatch, getState) => {
    const { audioPlayer } = getState();
    const { active } = audioPlayer;
    if (!active) {
      log.warn('audioPlayer.setPlaybackRate: No active message audio');
      return;
    }
    dispatch({
      type: 'audioPlayer/SET_PLAYBACK_RATE',
      payload: rate,
    });

    // update the preference for the conversation
    const { conversationId } = active.content;
    dispatch(
      setVoiceNotePlaybackRate({
        conversationId,
        rate,
      })
    );
  };
}

/**
 * Load message audio into the "content", the smart MiniPlayer will then play it
 */
function loadMessageAudio({
  voiceNoteData,
  position,
  context,
  ourConversationId,
}: {
  voiceNoteData: VoiceNoteAndConsecutiveForPlayback;
  position: number;
  context: string;
  ourConversationId: string;
}): SetMessageAudioAction {
  const {
    conversationId,
    voiceNote,
    consecutiveVoiceNotes,
    playbackRate,
    nextMessageTimestamp,
  } = voiceNoteData;
  return {
    type: 'audioPlayer/SET_MESSAGE_AUDIO',
    payload: {
      conversationId,
      context,
      current: voiceNote,
      queue: consecutiveVoiceNotes,
      isConsecutive: false,
      nextMessageTimestamp,
      ourConversationId,
      startPosition: position,
      playbackRate,
    },
  };
}

function setIsPlaying(value: boolean): SetIsPlayingAction {
  return {
    type: 'audioPlayer/SET_IS_PLAYING',
    payload: value,
  };
}

/**
 * alias for callers that just want to pause any voice notes before starting
 * their own playback: story viewer, media viewer, calling
 */
export function pauseVoiceNotePlayer(): ReturnType<typeof setIsPlaying> {
  return setIsPlaying(false);
}

export function unloadMessageAudio(): SetMessageAudioAction {
  return {
    type: 'audioPlayer/SET_MESSAGE_AUDIO',
    payload: undefined,
  };
}

export function getEmptyState(): AudioPlayerStateType {
  return {
    active: undefined,
  };
}

export function reducer(
  state: Readonly<AudioPlayerStateType> = getEmptyState(),
  action: Readonly<
    | AudioPlayerActionType
    | MessageDeletedActionType
    | MessageChangedActionType
    | MessagesAddedActionType
    | SelectedConversationChangedActionType
  >
): AudioPlayerStateType {
  const { active } = state;

  if (action.type === 'audioPlayer/SET_MESSAGE_AUDIO') {
    const { payload } = action;

    return {
      ...state,
      active:
        payload === undefined
          ? undefined
          : {
              currentTime: 0,
              duration: undefined,
              playing: true,
              playbackRate: payload.playbackRate,
              content: payload,
              startPosition: payload.startPosition,
            },
    };
  }

  if (action.type === 'audioPlayer/CURRENT_TIME_UPDATED') {
    if (!active) {
      return state;
    }
    return {
      ...state,
      active: {
        ...active,
        currentTime: action.payload,
      },
    };
  }

  if (action.type === 'audioPlayer/DURATION_CHANGED') {
    if (!active) {
      return state;
    }
    return {
      ...state,
      active: {
        ...active,
        duration: action.payload,
      },
    };
  }

  if (action.type === 'audioPlayer/SET_IS_PLAYING') {
    if (!active) {
      return state;
    }
    return {
      ...state,
      active: {
        ...active,
        playing: action.payload,
      },
    };
  }

  if (action.type === 'audioPlayer/SET_POSITION') {
    if (!active) {
      return state;
    }
    return {
      ...state,
      active: {
        ...active,
        startPosition: action.payload,
      },
    };
  }

  if (action.type === 'audioPlayer/SET_PLAYBACK_RATE') {
    if (!active) {
      return state;
    }
    return {
      ...state,
      active: {
        ...active,
        playbackRate: action.payload,
      },
    };
  }

  if (action.type === 'MESSAGES_ADDED') {
    if (!active) {
      return state;
    }
    const { content } = active;

    if (!content) {
      return state;
    }

    if (content.conversationId !== action.payload.conversationId) {
      return state;
    }

    const updatedQueue: Array<VoiceNoteForPlayback> = [...content.queue];

    for (const message of action.payload.messages) {
      if (message.deletedForEveryone) {
        continue;
      }
      if (message.timestamp < content.current.timestamp) {
        continue;
      }
      // in range of the queue
      if (
        content.nextMessageTimestamp === undefined ||
        message.timestamp < content.nextMessageTimestamp
      ) {
        if (message.type !== 'incoming' && message.type !== 'outgoing') {
          continue;
        }

        const voiceNote = extractVoiceNoteForPlayback(
          message,
          content.ourConversationId
        );

        // index of the message in the queue after this one
        const idx = updatedQueue.findIndex(
          m => m.timestamp > message.timestamp
        );

        // break up consecutive queue: drop values older than this message
        if (!voiceNote && idx !== -1) {
          updatedQueue.splice(idx);
          continue;
        }
        // insert a new voice note
        if (voiceNote) {
          if (idx === -1) {
            updatedQueue.push(voiceNote);
          } else {
            updatedQueue.splice(idx, 0, voiceNote);
          }
        }
      }
    }

    if (updatedQueue.length === content.queue.length) {
      return state;
    }

    return {
      ...state,
      active: {
        ...active,
        content: {
          ...content,
          queue: updatedQueue,
        },
      },
    };
  }

  if (action.type === 'audioPlayer/MESSAGE_AUDIO_ENDED') {
    if (!active) {
      return state;
    }
    const { content } = active;
    if (!content) {
      return state;
    }

    const { queue } = content;

    const [nextVoiceNote, ...newQueue] = queue;

    if (nextVoiceNote) {
      return {
        ...state,
        active: {
          ...active,
          startPosition: 0,
          content: {
            ...content,
            current: nextVoiceNote,
            queue: newQueue,
            isConsecutive: true,
          },
        },
      };
    }

    return {
      ...state,
      active: undefined,
    };
  }

  // Reset active when played message is deleted on expiration or DOE.
  if (
    action.type === 'MESSAGE_DELETED' ||
    (action.type === 'MESSAGE_CHANGED' &&
      action.payload.data.deletedForEveryone)
  ) {
    const { id } = action.payload;

    if (!active) {
      return state;
    }
    const { content } = active;

    // if we deleted the message currently being played
    // move on to the next message
    if (content.current.id === id) {
      const [next, ...rest] = content.queue;

      if (!next) {
        return {
          ...state,
          active: undefined,
        };
      }

      return {
        ...state,
        active: {
          ...active,
          content: {
            ...content,
            current: next,
            queue: rest,
          },
        },
      };
    }

    // if we deleted a message on the queue
    // just update the queue
    const message = content.queue.find(el => el.id === id);
    if (message) {
      return {
        ...state,
        active: {
          ...active,
          content: {
            ...content,
            queue: content.queue.filter(el => el.id !== id),
          },
        },
      };
    }

    return state;
  }

  // if it's a voice note
  // and this event is letting us know that it has downloaded
  // update the url if it's in the queue
  if (action.type === 'MESSAGE_CHANGED') {
    if (!active) {
      return state;
    }
    const { content } = active;

    if (!content) {
      return state;
    }

    const { id, data } = action.payload;

    const { attachments } = data;
    const attachment = attachments?.[0];
    if (
      !attachments ||
      !attachment ||
      !isAudio(attachments) ||
      !attachment.path
    ) {
      return state;
    }

    const url = getAttachmentUrlForPath(attachment.path);

    // if we got the url for the current message
    if (
      content.current.id === id &&
      content.current.url === undefined &&
      data.id
    ) {
      return {
        ...state,
        active: {
          ...active,
          content: {
            ...content,
            current: {
              ...content.current,
              url,
            },
          },
        },
      };
    }

    // if it's in the queue
    const idx = content.queue.findIndex(v => v.id === id);
    if (idx !== -1) {
      const updatedQueue = [...content.queue];
      updatedQueue[idx] = {
        ...updatedQueue[idx],
        url,
      };

      return {
        ...state,
        active: {
          ...active,
          content: {
            ...content,
            queue: updatedQueue,
          },
        },
      };
    }

    return state;
  }

  return state;
}
