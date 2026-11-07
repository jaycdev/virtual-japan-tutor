// Login: the signed-out screen. Same auth contract as before (#13): the
// Learner types Username / Password, presses "Log in", and Android can point
// the app at a different server address. This component owns presentation only — the auth machine lives
// in AuthGate, and a login attempt is handed up via onLogin.
import { useT } from "@vjt/core";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T } from "./components/Text.tsx";
import { useJapaneseFont } from "./japaneseFont/index.tsx";
import { InterfaceLanguageChoice } from "./interfacelanguage/LanguageChoice.tsx";
import { ServerField } from "./ServerField.tsx";

export interface LoginProps {
  busy: boolean;
  error: string | undefined;
  serverUrl: string;
  onLogin: (username: string, password: string) => void;
  onSaveServerUrl: (url: string) => Promise<void>;
}

export function Login({ busy, error, serverUrl, onLogin, onSaveServerUrl }: LoginProps) {
  const jp = useJapaneseFont();
  const { tp } = useT();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = () => {
    if (busy || !username || !password) return;
    onLogin(username, password);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View className="w-full max-w-[380px] gap-6 rounded-2xl bg-card p-6 shadow-md">
        <View className="items-center gap-1">
          {/* The brand wordmark is the kanji 読 in every Interface Language —
              brand art, not chrome: hidden from assistive tech (the app name
              below names the brand) and exempted from the coverage check by
              this testID, exactly as the web twin's aria-hidden marks it. */}
          <Text
            testID="brand-wordmark"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className={`text-display ${jp.regular} text-primary`}
            allowFontScaling={false}
          >
            {/* eslint-disable-next-line vjt/no-raw-jsx-text -- the brand wordmark is the kanji 読 in every Interface Language */}
            読
          </Text>
          <T k="brand.app" className="text-title-sm font-semibold text-foreground" />
        </View>

        <View className="gap-4">
          <View className="gap-1.5">
            <T k="login.username" className="text-small text-muted-foreground" />
            <TextInput
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-body text-foreground"
              value={username}
              onChangeText={setUsername}
              onSubmitEditing={submit}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              accessibilityLabel={tp("login.username")}
              editable={!busy}
            />
          </View>
          <View className="gap-1.5">
            <T k="login.password" className="text-small text-muted-foreground" />
            <TextInput
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-body text-foreground"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              secureTextEntry
              accessibilityLabel={tp("login.password")}
              editable={!busy}
            />
          </View>
        </View>

        {error ? (
          <Text className="text-small text-destructive" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Pressable
          className="min-h-12 items-center justify-center rounded-lg bg-primary disabled:opacity-50"
          accessibilityRole="button"
          accessibilityLabel={tp("login.logIn")}
          disabled={busy || !username || !password}
          onPress={submit}
        >
          {busy ? (
            <T k="login.loggingIn" className="text-body font-semibold text-primary-foreground" />
          ) : (
            <T k="login.logIn" className="text-body font-semibold text-primary-foreground" />
          )}
        </Pressable>

        {/* #125: the Interface Language switch sits at the card's foot, where
            a Learner can set the chrome language before signing in at all. */}
        <InterfaceLanguageChoice compact />

        <ServerField serverUrl={serverUrl} onSave={onSaveServerUrl} />
      </View>
    </ScrollView>
  );
}
