import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Text } from '@/components/ui/text';
import { PortalHost } from '@rn-primitives/portal';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Uniwind } from 'uniwind';

import { KanaSample } from './kana-sample';

/**
 * Dev-only showcase of the design foundations landed in issue #43: the
 * reworked palette (light + dark), type scale and Story text tokens,
 * uniwind theme modes, and the React Native Reusables component wrappers
 * in components/ui (@rn-primitives underneath). Served as the visual
 * evidence for the issue and as the starting point for ported screens
 * (issues #45/#46/#49). Never included in production builds — root
 * index.tsx resolves the `@dev/showcase` alias to the showcase-off stub, and
 * only the dev-only showcase entry wires this component in.
 *
 * uniwind 1.13 quirk (verified on Android device): a colour class listed
 * BEFORE a custom text-size class in className silently drops the colour
 * on native. Always write the size class first, e.g.
 * `className="text-title text-foreground"`.
 */
export function Showcase() {
  const [mode, setMode] = useState<'system' | 'light' | 'dark'>('system');

  const setTheme = (next: 'system' | 'light' | 'dark') => {
    setMode(next);
    Uniwind.setTheme(next);
  };

  return (
    <>
      <ScrollView className="flex-1 bg-background p-4">
        <Text className="text-title text-foreground">Design foundations showcase</Text>
        <Text className="text-small text-muted-foreground">
          dev-only · palette, type scale, theme modes, primitives
        </Text>

        <View className="mt-4 flex-row gap-2">
          {(['light', 'dark', 'system'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setTheme(m)}
              className={`rounded-[8px] px-3 py-2 ${mode === m ? 'bg-primary' : 'bg-muted'}`}
            >
              <Text className={`text-small ${mode === m ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
                {m}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text className="mt-6 text-title text-foreground">Type scale</Text>
        <Text className="mt-2 text-display text-foreground">Display 表示 text-display</Text>
        <Text className="mt-2 text-title text-foreground">Title 見出し text-title</Text>
        <Text className="mt-2 text-title-sm text-foreground">Title sm 小見出し text-title-sm</Text>
        <Text className="mt-2 text-body text-foreground">Body text 本文 text-body</Text>
        <Text className="mt-2 text-small text-muted-foreground">Small 補助 text-small</Text>
        <Text className="mt-2 text-caption text-muted-foreground">Caption 注記 text-caption</Text>

        <Text className="mt-6 text-title text-foreground">Story text sizes</Text>
        <Text className="mt-2 text-story-s text-foreground">Story S · 小さい話文 森 槐 二 十 歳</Text>
        <Text className="mt-2 text-story-m text-foreground">Story M · 標準の話文 森 槐 二 十 歳</Text>
        <Text className="mt-2 text-story-l text-foreground">Story L · 大きい話文 森 槐 二 十 歳</Text>
        <Text className="mt-2 text-story-xl text-foreground">Story XL · 最大 森</Text>
        <Text className="mt-3 text-body text-foreground">
          森 <Text className="text-furigana-m text-furigana">もり</Text> は <Text className="text-furigana-m text-furigana">かい</Text> を <Text className="text-furigana-m text-furigana">よ</Text>む
        </Text>

        <Text className="mt-6 text-title text-foreground">Reader colours</Text>
        <View className="mt-2 rounded-[10px] border border-border bg-card p-3">
          <Text className="text-body text-foreground">
            槐は<Text className="bg-lookup-mark">_lookup</Text>の語を<Text className="bg-grammar-focus">focus grammar</Text>で調べ、<Text className="bg-selected-sentence">selected sentence</Text>を選ぶ。
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            <Tag label="grammar" cls="bg-grammar" />
            <Tag label="focus" cls="bg-grammar-focus" />
            <Tag label="lookup" cls="bg-lookup-mark" />
            <Tag label="pitch" cls="bg-pitch" />
            <Tag label="success" cls="bg-success" />
          </View>
        </View>

        <KanaSample />

        <Text className="mt-6 text-title text-foreground">Primitives (components/ui, @rn-primitives)</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <Button onPress={() => {}}>
            <Text>Default</Text>
          </Button>
          <Button variant="secondary" onPress={() => {}}>
            <Text>Secondary</Text>
          </Button>
          <Button variant="outline" onPress={() => {}}>
            <Text>Outline</Text>
          </Button>
          <Button variant="ghost" onPress={() => {}}>
            <Text>Ghost</Text>
          </Button>
          <Button variant="destructive" onPress={() => {}}>
            <Text>Destructive</Text>
          </Button>
        </View>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <RnrDialogSample />
          <RnrPopoverSample />
          <RnrDropdownSample />
        </View>

        <Text className="mt-6 text-title text-foreground">Themed SVG asset</Text>
        <View className="mt-2 flex-row items-center gap-3">
          <KanaSample size={48} />
          <Text className="text-small text-muted-foreground">
            KanaSample re-colours with the active theme (useCSSVariable + design token).
          </Text>
        </View>

        <View className="mt-6 gap-2">
          <Button onPress={() => {}}>
            <Text>Browse lessons</Text>
          </Button>
          <Button variant="secondary" onPress={() => {}}>
            <Text>Review grammar</Text>
          </Button>
          <Button variant="destructive" onPress={() => {}}>
            <Text>Reset progress</Text>
          </Button>
          <Button variant="link" onPress={() => {}}>
            <Text className="text-primary">Report an issue</Text>
          </Button>
        </View>

      </ScrollView>
      {/* @rn-primitives overlays render into this host on native. Keep it OUTSIDE
          the ScrollView: `absolute inset-0` anchors to the host's parent, so a
          host inside the scroll content sizes overlays to the content, not the viewport. */}
      <PortalHost />
    </>
  );
}

function Tag({ label, cls }: { label: string; cls: string }) {
  return (
    <View className={`rounded-[8px] px-2 py-1 ${cls}`}>
      <Text className="text-small text-foreground">{label}</Text>
    </View>
  );
}

function RnrDialogSample() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Text>Open dialog</Text>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[85%] max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Review sentence</DialogTitle>
          <DialogDescription>森は槐を読む。Add this sentence to your review list?</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 flex-row gap-2 self-stretch">
          <DialogClose asChild>
            <Button variant="secondary">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>
              <Text>Add</Text>
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RnrPopoverSample() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Text>Open popover</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64">
        <Text className="text-small">槐 (かい) — nickname. Tap to look up.</Text>
      </PopoverContent>
    </Popover>
  );
}

function RnrDropdownSample() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Text>Story menu</Text>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuItem className="min-h-[44px] flex-row items-center px-3 py-2">
          <Text className="text-body text-popover-foreground">Continue reading</Text>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-[44px] flex-row items-center px-3 py-2">
          <Text className="text-body text-popover-foreground">Sentence lookup</Text>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
