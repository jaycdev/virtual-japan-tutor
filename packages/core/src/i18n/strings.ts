/**
 * The one typed string table behind every sentence @vjt/core shows a Learner
 * (issue #125). `en` is the copy the apps show today, byte for byte — the
 * existing tests pin it. `ja` carries its furigana inline in the Aozora
 * style, 今日《きょう》, so one column serves both Japanese options; the
 * i18n tests check every kanji in it is covered and every {placeholder}
 * appears in both columns. `{name}` values are substituted as plain data:
 * they are never parsed for furigana.
 *
 * The `exercise.*` and `errors.*` English text is only shown as a fallback
 * (the server answers in English, and exercises ask in Japanese); the columns
 * exist so the tests can pin the mapping and the client has something to
 * show when the server's own line is missing.
 *
 * Keys are dotted by area, but the object stays FLAT: `keyof typeof strings`
 * is the key union, and TS checks every call site against it.
 */

export const strings = {
  // — Failures the hooks show —
  "errors.unreachable": { en: "Cannot reach the server", ja: "サーバーに接続《せつぞく》できません" },
  "errors.failed": { en: "Request failed", ja: "リクエストに失敗《しっぱい》しました" },
  "errors.failedStatus": {
    en: "Request failed ({status})",
    ja: "リクエストに失敗《しっぱい》しました（{status}）",
  },
  // One line per server error code (the Go API's own English stays for en
  // via the fallback; the en column records what the server says).
  "errors.bad_request": { en: "Malformed request", ja: "リクエストの内容《ないよう》が正《ただ》しくありません" },
  "errors.internal": { en: "Internal server error", ja: "サーバー側《がわ》で問題《もんだい》が起《お》きました" },
  "errors.unauthorized": {
    en: "Missing, invalid or expired session token",
    ja: "セッションがないか、不正《ふせい》または期限《きげん》切《ぎ》れです",
  },
  "errors.invalid_credentials": {
    en: "Invalid username or password",
    ja: "ユーザー名《めい》またはパスワードが正《ただ》しくありません",
  },
  "errors.too_many_attempts": {
    en: "Too many login attempts",
    ja: "試行回数《しこうかいすう》が多《おお》すぎます。もう一度《いちど》お試《ため》しください",
  },
  "errors.payload_too_large": { en: "Request body too large", ja: "リクエストのデータが大《おお》きすぎます" },
  "errors.not_found": { en: "Not found", ja: "見《み》つかりませんでした" },
  "errors.invalid_settings": { en: "Invalid settings", ja: "設定《せってい》が正《ただ》しくありません" },
  "errors.invalid_rating": { en: "Invalid rating", ja: "評価《ひょうか》が正《ただ》しくありません" },
  "errors.story_not_ready": {
    en: "Story is not ready",
    ja: "物語《ものがたり》はまだ読《よ》める状態《じょうたい》にありません",
  },
  "errors.invalid_question": { en: "Invalid question", ja: "問題《もんだい》が正《ただ》しくありません" },
  "errors.invalid_answer": { en: "Invalid answer", ja: "回答《かいとう》が正《ただ》しくありません" },
  "errors.invalid_input": { en: "Invalid input", ja: "入力《にゅうりょく》が正《ただ》しくありません" },
  "errors.invalid_threshold": { en: "Invalid threshold", ja: "しきい値《ち》が正《ただ》しくありません" },
  "errors.invalid_preference": { en: "Invalid preference", ja: "優先《ゆうせん》設定《せってい》が正《ただ》しくありません" },
  "errors.invalid_timezone": { en: "Invalid timezone", ja: "タイムゾーンが正《ただ》しくありません" },
  "errors.generation_running": {
    en: "A story is already being generated",
    ja: "すでに物語《ものがたり》を作成中《さくせいちゅう》です",
  },
  "errors.no_story": { en: "No story", ja: "物語《ものがたり》がありません" },
  "errors.practice_no_items": { en: "No items to practice", ja: "練習《れんしゅう》できる項目《こうもく》がありません" },
  "errors.already_answered": { en: "Already answered", ja: "すでに回答《かいとう》しました" },
  "errors.duplicate_name": { en: "Duplicate name", ja: "同《おな》じ名前《なまえ》がすでに使《つか》われています" },
  "errors.reserved_list": { en: "Reserved list name", ja: "この名前《なまえ》は使《つか》えません" },
  "errors.invalid_key": { en: "Invalid key", ja: "APIキーが無効《むこう》です" },
  "errors.no_key": { en: "No key", ja: "APIキーがありません" },
  "errors.sync_running": {
    en: "A sync is already running",
    ja: "すでに同期《どうき》が実行中《じっこうちゅう》です",
  },
  "errors.invalid_level": { en: "Invalid level", ja: "レベルが正《ただ》しくありません" },
  "errors.name_taken": { en: "Name taken", ja: "この名前《なまえ》はすでに使《つか》われています" },
  "errors.invalid_provider": { en: "Invalid provider", ja: "AIプロバイダーが無効《むこう》です" },
  "errors.provider_in_use": { en: "Provider is in use", ja: "このAIプロバイダーはまだ使《つか》われています" },
  "errors.no_ai_provider": { en: "No AI provider", ja: "AIプロバイダーがありません" },
  "errors.emptyResponse": { en: "Empty response", ja: "空《から》の応答《おうとう》でした" },

  // — Sign-in (the app owns the form; these are core's failure lines) —
  "auth.loginFailed": { en: "Login failed", ja: "ログインに失敗《しっぱい》しました" },
  "auth.tryAgainLater": {
    en: "Too many attempts. Try again later.",
    ja: "試行回数《しこうかいすう》が多《おお》すぎます。もう一度《いちど》お試《ため》しください",
  },
  "auth.tryAgainIn": {
    en: "Too many attempts. Try again in {secs} seconds.",
    ja: "試行回数《しこうかいすう》が多《おお》すぎます。{secs}秒後《びょうご》にもう一度《いちど》お試《ため》しください",
  },
  "auth.sessionSaveFailed": {
    en: "Could not save the session on this device",
    ja: "この端末《たんまつ》にセッションを保存《ほぞん》できませんでした",
  },
  "auth.serverAnswered": { en: "Server answered {status}", ja: "サーバーが {status} と応答《おうとう》しました" },

  // — Story writing —
  "story.startFailed": { en: "Couldn't start writing a Story.", ja: "物語《ものがたり》の作成《さくせい》を開始《かいし》できませんでした。" },
  "story.runFailed": { en: "Couldn’t write a Story for you.", ja: "物語《ものがたり》を作成《さくせい》できませんでした。" },
  "story.originOnDemand": { en: "On demand", ja: "オンデマンド" },
  "story.originAutomatic": { en: "Automatic", ja: "自動生成《じどうせいせい》" },
  "story.noGenre": { en: "Story", ja: "物語《ものがたり》" },

  // — Genres (display only; stored values stay English). English maps only
  // diary/travel/mystery today; Japanese also covers the server's presets. —
  "genre.diary": { en: "Diary", ja: "日記《にっき》" },
  "genre.travel": { en: "Travel", ja: "旅行《りょこう》" },
  "genre.mystery": { en: "Mystery", ja: "ミステリー" },
  "genre.sliceOfLife": { en: "Slice of life", ja: "日常《にちじょう》" },
  "genre.folktale": { en: "Folktale", ja: "昔話《むかしばなし》" },
  "genre.food": { en: "Food", ja: "食《た》べ物《もの》" },
  "genre.schoolLife": { en: "School life", ja: "学校生活《がっこうせいかつ》" },
  "genre.cityLife": { en: "City life", ja: "都会《とかい》" },
  "genre.nature": { en: "Nature", ja: "自然《しぜん》" },

  // — The generation run's stages —
  "stage.preparing": { en: "Preparing…", ja: "準備中《じゅんびちゅう》…" },
  "stage.writing": { en: "Writing…", ja: "作成中《さくせいちゅう》…" },
  "stage.writingAttempt": {
    en: "Writing… attempt {attempt} of {max}",
    ja: "作成中《さくせいちゅう》… {attempt}回目《かいめ》（全《ぜん》{max}回《かい》）",
  },
  "stage.checking": { en: "Checking it fits your vocabulary…", ja: "語彙《ごい》に合《あ》うかどうか確認《かくにん》しています…" },
  "stage.saving": { en: "Saving…", ja: "保存中《ほぞんちゅう》…" },

  // — Today's greeting —
  "greeting.hello": { en: "Hello", ja: "こんにちは" },
  "greeting.morning": { en: "Good morning", ja: "おはようございます" },
  "greeting.afternoon": { en: "Good afternoon", ja: "こんにちは" },
  "greeting.evening": { en: "Good evening", ja: "こんばんは" },
  "greeting.lateNight": { en: "Still studying", ja: "遅《おそ》くまで勉強中《べんきょうちゅう》ですね" },

  // — Settings sections (titles and blurbs; ids stay route segments) —
  "section.appearanceTitle": { en: "Appearance", ja: "表示《ひょうじ》" },
  "section.appearanceBlurb": { en: "Colour theme and Story text size", ja: "テーマカラーと物語《ものがたり》の文字《もじ》の大《おお》きさ" },
  "section.readingTitle": { en: "Reading", ja: "読解《どっかい》" },
  "section.readingBlurb": { en: "Translation blur and Lookup hold", ja: "文《ぶん》の訳《やく》のぼかしと長押《ながお》しの時間《じかん》" },
  "section.storiesTitle": { en: "Stories", ja: "物語《ものがたり》" },
  "section.storiesBlurb": {
    en: "Furigana threshold and future story tastes",
    ja: "ふりがな表示《ひょうじ》レベルとこれからの物語《ものがたり》の趣向《しゅこう》",
  },
  "section.listsTitle": { en: "Item Lists", ja: "リスト" },
  "section.listsBlurb": { en: "Lists, boosting and saved items", ja: "リスト、優先《ゆうせん》と保存《ほぞん》項目《こうもく》" },
  "section.levelTitle": { en: "Starting Level", ja: "開始《かいし》レベル" },
  "section.levelBlurb": { en: "N5–N1 known grammar baseline", ja: "N5～N1 の既習《きしゅう》文法《ぶんぽう》基準《きじゅん》" },
  "section.marumoriTitle": { en: "MaruMori", ja: "MaruMori" },
  "section.marumoriBlurb": { en: "Connect your Junji profile and Sync", ja: "Junji プロフィールの接続《せつぞく》と同期《どうき》" },
  "section.aiTitle": { en: "AI Providers", ja: "AIプロバイダー" },
  "section.aiBlurb": { en: "Endpoints, keys and task assignments", ja: "エンドポイント、キー、タスク割当《わりあて》" },
  "section.serverTitle": { en: "Server", ja: "サーバー" },
  "section.serverBlurb": { en: "Connection health and server address", ja: "接続《せつぞく》状態《じょうたい》とサーバーアドレス" },

  // — The mobile Server settings reachability probe —
  "serverHealth.answered": {
    en: "That address answered {status} instead of a healthy /health. It does not look like a Virtual Japan Tutor server — the current address is still in use.",
    ja: "そのアドレスは正常《せいじょう》な /health の代《かわ》りに {status} と応答《おうとう》しました。Virtual Japan Tutor のサーバーではないようです — 現在《げんざい》のアドレスが使《つか》われ続《つづ》けます",
  },
  "serverHealth.noAnswer": {
    en: "That address did not answer. Check the host and port — the current address is still in use.",
    ja: "そのアドレスから応答《おうとう》がありませんでした。ホストとポートを確認《かくにん》してください — 現在《げんざい》のアドレスが使《つか》われ続《つづ》けます",
  },

  // — Item kinds and the list rows —
  "item.kanji": { en: "Kanji", ja: "漢字《かんじ》" },
  "item.vocabulary": { en: "Word", ja: "単語《たんご》" },
  "item.grammar": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "itemList.defaultWord": { en: "default", ja: "既定《きてい》" },
  "itemList.oneItem": { en: "{count} item", ja: "{count}項目《こうもく》" },
  "itemList.manyItems": { en: "{count} items", ja: "{count}項目《こうもく》" },
  "itemList.boostingWord": { en: "boosting", ja: "優先《ゆうせん》" },

  // — AI Provider rows —
  "aiTask.story": { en: "Story generation", ja: "物語《ものがたり》生成《せいせい》" },
  "aiTask.grammarContent": { en: "Grammar content", ja: "文法《ぶんぽう》コンテンツ" },
  "settings.ai.usedFor": { en: "used for {tasks}", ja: "{tasks}に使用《しよう》" },
  "settings.ai.keySaved": { en: "Key saved", ja: "キー保存《ほぞん》済《ず》み" },
  "settings.ai.noKey": { en: "No key", ja: "キーなし" },

  // — Focus Set chips —
  "focus.grammarPoint": { en: "Grammar point", ja: "文法《ぶんぽう》ポイント" },
  "focus.word": { en: "Word", ja: "単語《たんご》" },

  // — MaruMori Sync rows —
  "sync.failed": { en: "Sync failed: {error}", ja: "同期《どうき》に失敗《しっぱい》しました: {error}" },
  "sync.unknownError": { en: "unknown error", ja: "原因《げんいん》不明《ふめい》" },
  "sync.complete": { en: "Sync complete", ja: "同期《どうき》完了《かんりょう》" },
  "sync.counts": {
    en: "Sync complete — {new} new Known Items, {levelChanges} level changes, {disappeared} disappeared",
    ja: "同期《どうき》完了《かんりょう》 — 新《あらた》な既習項目《きしゅうこうもく》 {new}件《けん》、レベル変化《へんか》 {levelChanges}件《けん》、消《き》えた項目《こうもく》 {disappeared}件《けん》",
  },
  "sync.runCounts": {
    en: "{kanji} kanji, {vocabulary} vocabulary",
    ja: "漢字《かんじ》 {kanji}件《けん》、語彙《ごい》 {vocabulary}件《けん》",
  },

  // — Grammar Catalogue Matching rows —
  "grammarReview.level": { en: "(MaruMori level {level})", ja: "（MaruMori レベル {level}）" },
  "grammarReview.matched": {
    en: "— matched point {point}, level was ambiguous",
    ja: "— 一致《いち》したポイント {point}、レベルが曖昧《あいまい》でした",
  },
  "grammarReview.noMatch": { en: "— no Grammar Catalogue match", ja: "— 文法《ぶんぽう》カタログの一致《いち》なし" },
  "grammar.updated": {
    en: "Grammar updated: {added} added, {removed} removed.",
    ja: "文法《ぶんぽう》を更新《こうしん》しました: {added}件《けん》追加《ついか》、{removed}件《けん》削除《さくじょ》",
  },

  // — Settings field rules —
  "settings.lookupHoldRule": {
    en: "The hold is a whole number of milliseconds from 0 to 10000.",
    ja: "長押《ながお》し時間《じかん》は 0 から 10000 のミリ秒《びょう》の整数《せいすう》です。",
  },

  // — The Lookup Menu (issue #14) —
  "reader.menu.dictionary": { en: "Dictionary", ja: "辞書《じしょ》" },
  "reader.menu.grammar": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "reader.menu.save": { en: "Save", ja: "保存《ほぞん》" },
  "reader.menu.saveTo": { en: "Save to…", ja: "保存《ほぞん》…" },
  "reader.menu.unlinked": {
    en: "This word did not match a dictionary entry",
    ja: "この語《ことば》は辞書《じしょ》の項目《こうもく》に見《み》つかりませんでした",
  },
  "reader.menu.lookupFailed": {
    en: "The dictionary did not answer — hold again to try once more",
    ja: "辞書《じしょ》が応答《おうとう》しませんでした — 再《ふたた》び長押《ながお》しすると再試行《さいしこう》できます",
  },
  "reader.menu.listsLoading": {
    en: "Your Item Lists are still loading",
    ja: "リストの読《よ》み込《こ》み中《ちゅう》です",
  },
  "reader.menu.saveToTarget": { en: "Save to {list}", ja: "{list}に保存《ほぞん》" },
  "reader.menu.saveToDefault": { en: "Save to the default list", ja: "既定《きてい》のリストに保存《ほぞん》" },
  "reader.menu.saveToOther": { en: "Save into another Item List", ja: "他《ほか》のリストに保存《ほぞん》" },

  // — Practice exercises (the server's English stays for en) —
  "exercise.recognition": { en: "What does this mean?", ja: "意味《いみ》はどれですか？" },
  "exercise.grammar_cloze": {
    en: "Which pattern completes the sentence?",
    ja: "文《ぶん》を完成《かんせい》させるのはどのパターンですか？",
  },

  // — Nav, page titles, and shell chrome (issue #125 Part 2) —
  // The brand is the product name: same text in both columns on purpose.
  "brand.app": { en: "Virtual Japan Tutor", ja: "Virtual Japan Tutor" },
  "nav.today": { en: "Today", ja: "今日《きょう》" },
  "nav.stories": { en: "Stories", ja: "物語《ものがたり》" },
  "nav.practice": { en: "Practice", ja: "練習《れんしゅう》" },
  "nav.grammar": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "nav.settings": { en: "Settings", ja: "設定《せってい》" },
  "settings.notFound": { en: "That settings section doesn’t exist.", ja: "その設定《せってい》セクションはありません。" },
  "settings.back": { en: "Back to Settings", ja: "設定《せってい》へ戻《もど》る" },
  "settings.backShort": { en: "← Settings", ja: "← 設定《せってい》" },
  "settings.sectionsAria": { en: "Settings sections", ja: "設定《せってい》セクション" },
  "settings.focusTitle": { en: "Today’s Focus Set", ja: "本日《ほんじつ》の焦点《しょうてん》セット" },
  "settings.loadFailed": {
    en: "Cannot load your {what}: {message}",
    ja: "あなたの{what}を読《よ》み込《こ》せません: {message}",
  },
  "settings.readingWhat": { en: "reading settings", ja: "読《よ》み設定《せってい》" },
  "settings.readingSaved": {
    en: "Saved. The reader uses this from the next lookup on.",
    ja: "保存《ほぞん》しました。次《つぎ》の検索《けんさく》から読《よ》み画面《がめん》に使《つか》われます。",
  },
  "settings.blurLabel": {
    en: "Blur the translation behind Weak Signals",
    ja: "Weak Signalの裏《うら》の訳《やく》をぼかす",
  },
  "settings.blurHint": {
    en: "A word you have not practised enough shows its meaning only after you ask.",
    ja: "十分《じゅうぶん》練習《れんしゅう》していない語《ことば》は、頼《たの》んでからの意味《いみ》を表示《ひょうじ》します。",
  },
  "settings.holdNote": {
    en: "How long you must hold a lookup before it counts as a Weak Signal. 0 signals every lookup.",
    ja: "検索《けんさく》を長《なが》く押《お》し続《つづ》けるとWeak Signalにカウントされます。0ならすべての検索《けんさく》が対象《たいしょう》です。",
  },
  "settings.holdLabel": {
    en: "Lookup hold before a Weak Signal (ms, 0–10000)",
    ja: "Weak Signalまでの検索《けんさく》長《なが》押《お》し（ms、0〜10000）",
  },
  "settings.saveReading": { en: "Save reading settings", ja: "読《よ》み設定《せってい》を保存《ほぞん》" },

  // The Server section: a health read only (ui-plan 4.7).
  "server.addressLabel": { en: "Server address", ja: "サーバーアドレス" },
  "server.addressNote": {
    en: "The app talks to the server it was loaded from, so there is no address to change here.",
    ja: "このアプリは読《よ》み込《こ》んだサーバーと通信《つうしん》するので、ここで変《か》えられるアドレスはありません。",
  },
  "server.unreachable": { en: "Cannot reach the server: {message}", ja: "サーバーに接続《せつぞく》できません: {message}" },
  "server.healthy": {
    en: "The server is reachable and its database is connected.",
    ja: "サーバーは接続《せつぞく》可能《かのう》で、データベースもつながっています。",
  },
  "server.answeredBut": { en: "The server answered, but {what}", ja: "サーバーは応答《おうとう》しましたが、{what}" },
  "server.dbUnreachable": { en: "cannot reach its database.", ja: "データベースに接続《せつぞく》できません。" },
  "server.degradedPart": { en: "reports a degraded part.", ja: "一部《いちぶ》の機能《きのう》が劣化《れっか》しています。" },
  "server.checkAgain": { en: "Check again", ja: "再《ふたた》び確認《かくにん》" },

  // The full Focus Set behind Today's "See all".
  "settings.focusLoadFailed": {
    en: "Cannot load your Focus Set: {message}",
    ja: "焦点《しょうてん》セットを読《よ》み込《こ》せません: {message}",
  },
  "settings.focusNote": {
    en: "These are the items your Stories and Practice are built around.",
    ja: "これらは物語《ものがたり》と練習《れんしゅう》が作《つく》られる基《もと》の項目《こうもく》です。",
  },
  "settings.focusNoteLimit": {
    en: "These are the items your Stories and Practice are built around, up to {size} at a time.",
    ja: "これらは物語《ものがたり》と練習《れんしゅう》が作《つく》られる基《もと》の項目《こうもく》で、同時《どうじ》に最大《さいだい》{size}件《けん》です。",
  },
  "settings.focusEmpty": {
    en: "Nothing chosen yet — a Sync, a Story or a Practice session fills it in.",
    ja: "まだ何《なに》も選《えら》ばれていません — 同期《どうき》、物語《ものがたり》、練習《れんしゅう》セッションが埋《う》めます。",
  },
  "settings.focusAria": { en: "Focus Set", ja: "焦点《しょうてん》セット" },
  "nav.main": { en: "Main", ja: "メイン" },
  "title.logIn": { en: "Log in", ja: "ログイン" },
  "title.setUp": { en: "Set up", ja: "セットアップ" },
  "title.notFound": { en: "Not found", ja: "ページが見《み》つかりません" },
  "shell.skipToContent": { en: "Skip to content", ja: "本文《ほんぶん》へ" },
  "shell.openNavigation": { en: "Open navigation", ja: "ナビゲーションを開《ひら》く" },
  "shell.navTitle": { en: "Navigation", ja: "ナビゲーション" },
  "shell.navDescription": {
    en: "Move between Today, Stories, Practice, Grammar and Settings.",
    ja: "今日《きょう》、物語《ものがたり》、練習《れんしゅう》、文法《ぶんぽう》、設定《せってい》を移動《いどう》します。",
  },
  "shell.signedInAs": { en: "Signed in as", ja: "ログイン中《ちゅう》" },
  "shell.logOut": { en: "Log out", ja: "ログアウト" },
  "common.retry": { en: "Retry", ja: "もう一度《いちど》" },
  "common.previous": { en: "Previous", ja: "前《まえ》へ" },
  "common.next": { en: "Next", ja: "次《つぎ》へ" },

  // — Stories page (issue #125) —
  "stories.writing": { en: "Writing…", ja: "書《か》いています…" },
  "stories.libraryHeading": { en: "Story Library", ja: "物語《ものがたり》ライブラリ" },
  "stories.ariaLayout": { en: "Library layout", ja: "ライブラリの表示《ひょうじ》形式《けいしき》" },
  "stories.gridLayout": { en: "Grid layout", ja: "グリッド表示《ひょうじ》" },
  "stories.listLayout": { en: "List layout", ja: "リスト表示《ひょうじ》" },
  "stories.filterUnread": { en: "Unread", ja: "未《み》読《どく》" },
  "stories.filterAll": { en: "All", ja: "すべて" },
  "stories.genre": { en: "Genre", ja: "ジャンル" },
  "stories.allGenres": { en: "All genres", ja: "すべてのジャンル" },
  "stories.noneMatch": {
    en: "No Stories match these filters.",
    ja: "このフィルタに合《あ》う物語《ものがたり》はありません。",
  },
  "stories.clearFilters": { en: "Clear filters", ja: "フィルタをクリア" },
  "stories.noneFiltered": {
    en: "No Stories yet — and nothing to filter.",
    ja: "物語《ものがたり》はまだありません。フィルタも適用《てきよう》できません。",
  },
  "stories.noneAny": {
    en: "No Stories yet. The tutor writes one for you every day, or Generate writes one now.",
    ja: "物語《ものがたり》はまだありません。指導《しどう》システムは毎日《まいにち》書《か》きます。「作《つく》る」で今《いま》書《か》くこともできます。",
  },
  "stories.hiddenByFilter": {
    en: "{hidden} of the {total} Stories on this page are hidden by your filters.",
    ja: "このページ{total}編《ぺん》の物語《ものがたり》のうち{hidden}編《ぺん》がフィルタで隠《かく》れています。",
  },
  "stories.newer": { en: "Newer stories", ja: "新《あたら》しい物語《ものがたり》" },
  "stories.older": { en: "Older stories", ja: "以前《いぜん》の物語《ものがたり》" },
  "stories.pageRange": { en: "{from}-{to} of {total}", ja: "{total}編《ぺん》中《ちゅう》{from}〜{to}編《ぺん》" },
  "stories.generateBody": {
    en: "One new Story now. Genre and Theme are optional — leave them on Any and the tutor chooses.",
    ja: "今《いま》、新《あら》たな物語《ものがたり》を一《いち》編《ぺん》。ジャンルとテーマは任意《にんい》です。選《えら》ばないままにすると指導《しどう》システムが選《えら》びます。",
  },
  "stories.theme": { en: "Theme", ja: "テーマ" },
  "stories.anyGenre": { en: "Any genre", ja: "どのジャンルでも" },
  "stories.anyTheme": { en: "Any theme", ja: "どのテーマでも" },
  "stories.keepWriting": {
    en: "It keeps writing if you close this dialog.",
    ja: "このダイアログを閉《と》じても書《か》き続《つづ》けます。",
  },
  "stories.generateConfirm": { en: "Generate", ja: "作《つく》る" },
  "stories.deleteTitle": {
    en: "Delete this Story?",
    ja: "この物語《ものがたり》を削除《さくじょ》しますか？",
  },
  "stories.deleteBody": {
    en: "“{title}” goes away for good, along with its rating. Your Practice Records stay.",
    ja: "「{title}」は評価《ひょうか》とともに削除《さくじょ》されます。練習《れんしゅう》記録《きろく》は残《のこ》ります。",
  },
  "stories.deleteKeep": { en: "Keep", ja: "残《のこ》す" },
  "stories.delete": { en: "Delete", ja: "削除《さくじょ》" },
  "stories.readBadge": { en: "Read", ja: "読《よ》み終《お》わり" },
  "stories.ariaOpen": { en: "Open story: {title}", ja: "物語《ものがたり》を開《ひら》く: {title}" },
  "stories.ariaActions": { en: "Actions for {title}", ja: "{title}の操作《そうさ》" },
  "stories.markRead": { en: "Mark read", ja: "読《よ》んだことにする" },
  "stories.markUnread": { en: "Mark unread", ja: "未《み》読《どく》にする" },
  "stories.ariaShowTranslation": {
    en: "Show title translation",
    ja: "タイトル訳《やく》を表示《ひょうじ》",
  },
  "stories.translationHidden": {
    en: "Title translation hidden — click to show",
    ja: "タイトル訳《やく》は隠《かく》れています — クリックで表示《ひょうじ》",
  },
  "common.cancel": { en: "Cancel", ja: "キャンセル" },
  "notFound.message": { en: "There is nothing at this address.", ja: "このアドレスにページはありません。" },
  "notFound.goToToday": { en: "Go to Today", ja: "今日《きょう》へ" },

  // — Login, first-run setup, and placeholder pages (issue #125 Part 2) —
  "login.username": { en: "Username", ja: "ユーザー名《めい》" },
  "login.password": { en: "Password", ja: "パスワード" },
  "login.logIn": { en: "Log in", ja: "ログイン" },
  "login.loggingIn": { en: "Logging in…", ja: "ログイン中《ちゅう》…" },
  "comingSoon.soon": { en: "Coming soon in #{issue}.", ja: "#{issue} で公開《こうかい》予定《よてい》です。" },
  "comingSoon.backToToday": { en: "Back to Today", ja: "今日《きょう》に戻《もど》る" },
  "setup.intro": {
    en: "Three short steps to set you up. You can skip any of them and change everything later under Settings.",
    ja: "短《みじか》い3つのステップで設定《せってい》します。どのステップもスキップでき、全《すべ》ての設定《せってい》は後《あと》で変《か》えられます。",
  },
  "setup.stepsLabel": { en: "Setup steps", ja: "設定《せってい》のステップ" },
  "setup.stepOf": { en: "Step {step} of {total}", ja: "ステップ{step}/{total}" },
  "setup.levelBody": {
    en: "We will build your First Story around this.",
    ja: "初《はじ》めの物語《ものがたり》はこのレベルをもとに作《つく》ります。",
  },
  "setup.marumoriBody": {
    en: "Add your key to keep your kanji study in sync.",
    ja: "漢字《かんじ》の学習《がくしゅう》を同期《どうき》するには、キーを追加《ついか》してください。",
  },
  "setup.aiBody": {
    en: "Tell us which model writes your Stories.",
    ja: "物語《ものがたり》を書《か》くモデルを選《えら》んでください。",
  },
  "setup.blockedNote": {
    en: "The step could not be saved. Fix it and try again, or skip this step.",
    ja: "ステップを保存《ほぞん》できませんでした。修正《しゅうせい》してもう一《いち》度《ど》試《ため》すか、このステップをスキップしてください。",
  },
  "setup.back": { en: "Back", ja: "前《まえ》へ" },
  "setup.skipAll": { en: "Skip setup", ja: "設定《せってい》をスキップ" },
  "setup.skipStep": { en: "Skip this step", ja: "このステップをスキップ" },
  "setup.next": { en: "Next", ja: "次《つぎ》へ" },
  "setup.finish": { en: "Finish", ja: "完《かん》了《りょう》" },
  "today.timezoneUnavailable": {
    en: "Timezone unavailable — showing your browser’s time.",
    ja: "タイムゾーンを取得《しゅとく》できません。ブラウザの時《とき》を表示《ひょうじ》しています。",
  },
  "today.focusHeading": { en: "Focus", ja: "焦点《しょうてん》" },
  "today.wordsLabel": { en: "Words", ja: "単語《たんご》" },
  "today.grammarLabel": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "today.focusEmpty": {
    en: "No Focus Set yet — add words on Maru Mori and choose the set in Settings › Focus.",
    ja: "焦点《しょうてん》セットはまだありません。Maru Mori で単語《たんご》を追加《ついか》し、設定《せってい》›焦点《しょうてん》でセットを選《えら》んでください。",
  },
  "today.focusStudyMaruMori": { en: "Study on Maru Mori", ja: "Maru Mori で学習《がくしゅう》" },
  "today.focusOpenSet": { en: "Open Focus Set", ja: "焦点《しょうてん》セットを開《ひら》く" },
  "today.wordsCount": { en: "{count} words", ja: "{count}語《ご》" },
  "today.storyHeading": { en: "Today’s Story", ja: "今日《きょう》の物語《ものがたり》" },
  "today.storyEmptyToday": {
    en: "No Story yet — the tutor writes one for you every day.",
    ja: "物語《ものがたり》はまだありません。指導《しどう》システムは毎日《まいにち》書《か》きます。",
  },
  "today.storyEmptyStories": {
    en: "No Story for today yet — the tutor writes one for you every day.",
    ja: "今日《きょう》の物語《ものがたり》はまだありません。指導《しどう》システムは毎日《まいにち》書《か》きます。",
  },
  "today.storyGenerating": {
    en: "A new Story is on its way — you can leave and come back.",
    ja: "新《あらた》な物語《ものがたり》を作《つく》っています。離《はな》れても戻《もど》って見《み》られます。",
  },
  "today.storyError": {
    en: "Cannot load today’s Story: {message}",
    ja: "今日《きょう》の物語《ものがたり》を読《よ》み込《こ》めません: {message}",
  },
  "today.storyGenerate": { en: "Generate a Story", ja: "物語《ものがたり》を作《つく》る" },
  "today.storyRetry": { en: "Try again", ja: "再《ふたた》び試《ため》す" },
  "today.storyCheckAgain": { en: "Check again", ja: "再《ふたた》び確《たし》かめる" },
  "today.storyStillUnread": {
    en: "Still unread from {date}.",
    ja: "{date}の読《よ》んでいない物語《ものがたり》があります。",
  },
  "today.storyReadAgain": { en: "Read again", ja: "再《ふたた》び読《よ》む" },
  "today.storyOpen": { en: "Open", ja: "開《ひら》く" },
  "today.storyAriaReadAgain": {
    en: "Read again today’s Story: {title}",
    ja: "今日《きょう》の物語《ものがたり》を再《ふたた》び読《よ》む: {title}",
  },
  "today.storyAriaOpen": {
    en: "Open today’s Story: {title}",
    ja: "今日《きょう》の物語《ものがたり》を開《ひら》く: {title}",
  },
  "today.storyReadyNow": { en: "Ready, read now", ja: "読《よ》み始《はじ》められます" },
  "today.storyNewerWriting": {
    en: "A newer Story is being written.",
    ja: "新《あら》たな物語《ものがたり》を書《か》いています。",
  },
  "today.syncNow": { en: "Sync now", ja: "今《いま》同期《どうき》" },
  "today.syncSyncing": { en: "Syncing…", ja: "同期《どうき》中《ちゅう》…" },
  "today.moreCount": { en: "+{count} more", ja: "他《ほか》{count}件《けん》" },
  "today.focusSetHeading": { en: "Focus Set", ja: "焦点《しょうてん》セット" },
  "today.seeAll": { en: "See all", ja: "すべて見《み》る" },
  "today.focusReadError": {
    en: "Your Focus Set could not be read.",
    ja: "焦点《しょうてん》セットを読《よ》み込《こ》めませんでした。",
  },
  "today.focusNothingChosen": {
    en: "Nothing chosen yet — a Sync, a Story or a Practice session fills it in.",
    ja: "まだ選《えら》ばれていません。同期《どうき》・物語《ものがたり》・練習《れんしゅう》で自動《じどう》的《てき》に決《き》まります。",
  },
  "today.focusAriaGlance": { en: "Focus Set at a glance", ja: "焦点《しょうてん》セット一覧《いちらん》" },
  "today.lastSyncHeading": { en: "Last sync", ja: "最終《さいしゅう》同期《どうき》" },
  "today.syncFailedFallback": { en: "Sync failed.", ja: "同期《どうき》に失敗《しっぱい》しました。" },
  "today.syncSucceededNote": { en: "Sync succeeded.", ja: "同期《どうき》が完了《かんりょう》しました。" },
  "today.syncNotLinked": {
    en: "No MaruMori account linked yet, so nothing has been synced.",
    ja: "MaruMoriアカウントが接続《せつぞく》されていないため、同期《どうき》されていません。",
  },
  "today.syncLinkMaruMori": { en: "Link MaruMori", ja: "MaruMoriを接続《せつぞく》" },
  "today.syncFailedLine": {
    en: "Last sync failed {time}.",
    ja: "最終《さいしゅう》同期《どうき》は{time}に失敗《しっぱい》しました。",
  },
  "today.syncNoneYet": {
    en: "No sync has finished yet. Press Sync now to pull your knowledge across.",
    ja: "まだ同期《どうき》が完了《かんりょう》していません。「今《いま》同期《どうき》」を押《お》して学習《がくしゅう》状況《じょうきょう》を取《と》り込《こ》んでください。",
  },
  "today.syncSucceededLine": {
    en: "Last sync succeeded {time}.",
    ja: "最終《さいしゅう》同期《どうき》は{time}に完了《かんりょう》しました。",
  },
  "today.syncNoCounts": {
    en: "The sync finished with no counts to report.",
    ja: "同期《どうき》は報告《ほうこく》できる件数《けんすう》なく終《お》わりました。",
  },
  "today.syncResultCounts": {
    en: "{new} new item{newPlural}, {levelChanges} level change{levelPlural}, {linked} linked to reference data.",
    ja: "新《あら》たな項目《こうもく》{new}件《けん》{newPlural}、レベル変《へん》化《か》{levelChanges}件《けん》{levelPlural}、参照《さんしょう》データとの連《つな》がり{linked}件《けん》。",
  },
  "today.practiceHeading": { en: "Practice", ja: "練習《れんしゅう》" },
  "today.practiceWaitingNone": {
    en: "Nothing is waiting in your Focus Set yet.",
    ja: "焦点《しょうてん》セットに待《ま》ち項《こう》目《もく》はありません。",
  },
  "today.practiceWaitingCount": {
    en: "{count} Focus Set item{plural} waiting.",
    ja: "焦点《しょうてん》セットに待《ま》ち項《こう》目《もく》{count}件《けん》{plural}。",
  },
  "today.practiceSessionNote": {
    en: "A session is built from your Focus Set, so there is nothing to practise until a Sync or a Story adds items.",
    ja: "練習《れんしゅう》は焦点《しょうてん》セットで作《つく》ります。同期《どうき》や物語《ものがたり》で項《こう》目《もく》が増《ふ》えるまで練習《れんしゅう》できません。",
  },
  "today.practiceStart": { en: "Start", ja: "始《はじ》める" },
  "today.practiceStartAria": { en: "Start practice", ja: "練習《れんしゅう》を始《はじ》める" },
  "today.practiceSession": { en: "{done} of {total} done · {kind}", ja: "{done}/{total}完《かん》了《りょう》 · {kind}" },
  "language.legend": { en: "Interface language", ja: "表示《ひょうじ》言語《げんご》" },
  "language.hint": {
    en: "Saved on this device. Stories, exercises and dictionary lookups stay Japanese whatever you choose.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。物語《ものがたり》・練習《れんしゅう》・辞書《じしょ》の引《ひ》き出《だ》しは常《つね》に日本語《にほんご》です。",
  },
  "settings.themeLegend": { en: "Theme", ja: "テーマ" },
  "settings.themeLight": { en: "Light", ja: "ライト" },
  "settings.themeDark": { en: "Dark", ja: "ダーク" },
  "settings.themeSystem": { en: "System", ja: "システム" },
  "settings.savedTheme": {
    en: "Saved on this device. System follows your computer.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。システムはコンピュータの設定《せってい》に従《したが》います。",
  },
  "settings.japaneseFontLegend": { en: "Japanese font", ja: "日本語《にほんご》フォント" },
  "settings.fontSerif": { en: "Serif", ja: "明朝《みんちょう》" },
  "settings.fontSans": { en: "Sans", ja: "ゴシック" },
  "settings.savedFont": {
    en: "Saved on this device. Sans is plainer, with simpler strokes; it applies to all Japanese text.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。ゴシックは線《せん》が簡《かん》単《たん》で少《すく》ない書《しょ》体《たい》です。日本語《にほんご》のテキスト全《まった》く同《おな》じ設定《せってい》になります。",
  },
  "settings.storySizeLegend": { en: "Story text size", ja: "物語《ものがたり》の文字《もじ》の大《おお》きさ" },
  "settings.saving": { en: "Saving…", ja: "保存中《ほぞんちゅう》…" },
  "settings.saved": { en: "Saved.", ja: "保存《ほぞん》しました。" },
  "settings.savedSize": {
    en: "Saved on this device. The size applies to Story text and the Reading Panel.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。大《おお》きさは物語《ものがたり》の本文《ほんぶん》と読《よ》み解《と》きパネルに適用《てきよう》されます。",
  },

  // — The web Story reader chrome (issue #125 Part 2) —
  "reader.backToStories": { en: "Back to stories", ja: "物語《ものがたり》へ戻《もど》る" },
  "reader.hideTranslation": { en: "Hide translation", ja: "翻訳《ほんやく》を隠《かく》す" },
  "reader.showTranslation": { en: "Show translation", ja: "翻訳《ほんやく》を表示《ひょうじ》" },
  "reader.panelAria": { en: "Reading Panel", ja: "読《よ》み解《と》きパネル" },
  "reader.wordMeaning": { en: "Word meaning", ja: "単語《たんご》の意味《いみ》" },
  "reader.panelHint": {
    en: "Select a sentence to read its translation. Hover or focus a word to see its meaning.",
    ja: "文《ぶん》を選《えら》ぶと訳《やく》が読《よ》めます。語《ことば》にホバーまたはフォーカスすると意味《いみ》が分《わか》ります。",
  },
  "reader.sentenceTranslationAria": { en: "Sentence Translation", ja: "文《ぶん》の訳《やく》" },
  "reader.translationHiddenNote": {
    en: "Translation hidden — click or press Enter to show",
    ja: "翻訳《ほんやく》は隠《かく》れています — クリックまたは Enter で表示《ひょうじ》",
  },
  "reader.blurSaveFailed": { en: "Could not save that — {message}", ja: "保存《ほぞん》できませんでした — {message}" },
  "reader.saveFailed": { en: "Could not save — {message}", ja: "保存《ほぞん》できません — {message}" },
  "reader.saveListsLoading": {
    en: "Could not save — Your Item Lists are still loading",
    ja: "保存《ほぞん》できません — リストの読《よ》み込《こ》み中《ちゅう》です",
  },
  "reader.savedToList": { en: "Saved to {list}.", ja: "{list}に保存《ほぞん》しました。" },
  "reader.yourList": { en: "your list", ja: "あなたのリスト" },
  "reader.listVanished": { en: "the new list vanished", ja: "新《あたら》しいリストが消《き》えました" },
  "reader.wordMenuAria": { en: "Word menu", ja: "語《ことば》のメニュー" },
  "reader.dictionaryEntry": { en: "Dictionary Entry", ja: "辞書《じしょ》の項目《こうもく》" },
  "reader.dictNoAnswer": {
    en: "The dictionary did not answer.",
    ja: "辞書《じしょ》が応答《おうとう》しませんでした",
  },
  "reader.grammarPoint": { en: "Grammar Point", ja: "文法《ぶんぽう》ポイント" },
  "reader.saveToDescription": {
    en: "Save the word or pattern to one of your lists.",
    ja: "この語《ことば》またはパターンをリストのどれかに保存《ほぞん》します。",
  },
  "reader.comprehension": { en: "Comprehension", ja: "理解《りかい》" },
  "reader.answerOption": { en: "Answer {n}: {option}", ja: "答《こた》え {n}: {option}" },
  "reader.correct": { en: "Correct.", ja: "正《ただ》しいです。" },
  "reader.notQuite": {
    en: "Not quite — the answer is above your selection.",
    ja: "惜《お》しい — 答《こた》えは選《えら》んだものの上《うえ》にあります",
  },
  "reader.prevStoryAria": { en: "Previous story", ja: "前《まえ》の物語《ものがたり》" },
  "reader.nextStoryAria": { en: "Next story", ja: "次《つぎ》の物語《ものがたり》" },
  "reader.unmarkReadAria": { en: "Unmark read", ja: "読《よ》んだ設定《せってい》を戻《もど》す" },
  "reader.read": { en: "Read", ja: "読《よ》む" },
  "reader.rateUpAria": { en: "Rate up", ja: "良《よ》い評価《ひょうか》" },
  "reader.rateDownAria": { en: "Rate down", ja: "悪《わる》い評価《ひょうか》" },
  "reader.practiceThis": { en: "Practice this Story", ja: "この物語《ものがたり》を練習《れんしゅう》" },
  "reader.newListName": { en: "New list name", ja: "新《あたら》しいリストの名前《なまえ》" },
  "reader.createAndSaveAria": { en: "Create a new list and save", ja: "新《あたら》しいリストを作《つく》って保存《ほぞん》" },
  "reader.create": { en: "Create", ja: "作《つく》る" },
  "reader.srs": { en: "SRS {level}", ja: "SRS {level}" },
  "reader.pitchHeiban": { en: "heiban (flat)", ja: "平板《へいばん》（フラット）" },
  "reader.pitchDownstep": { en: "downstep after mora {n}", ja: "モーラ{n}の落《お》ち目《め》" },

  // — The web Practice screen (issue #125 Part 2) —
  "practice.heading": { en: "Practice", ja: "練習《れんしゅう》" },
  "practice.building": {
    en: "Building your session from the Focus Set…",
    ja: "焦点《しょうてん》セットから練習《れんしゅう》を作《つく》っています…",
  },
  "practice.next": {
    en: "The next exercise is on its way…",
    ja: "次《つぎ》の練習《れんしゅう》は準備《じゅんび》中《ちゅう》です…",
  },
  "practice.intro": {
    en: "A session is about twenty exercises drawn from your Focus Set, recognition and grammar cloze. Every answer feeds your mastery record.",
    ja: "1回《かい》の練習《れんしゅう》は焦点《しょうてん》セットから作《つく》る約《やく》20問《もん》。意味《いみ》を問《と》う問題《もんだい》と文法《ぶんぽう》の穴埋《うず》め問題《もんだい》です。答《こた》えはすべて習熟《しゅうじゅく》記録《きろく》に反《はん》映《えい》します。",
  },
  "practice.start": { en: "Start a practice session", ja: "練習《れんしゅう》を始《はじ》める" },
  "practice.empty": {
    en: "Nothing in your Focus Set to practise yet",
    ja: "練習《れんしゅう》できる焦点《しょうてん》セットの項目《こうもく》はまだありません",
  },
  "practice.openLists": { en: "Open your Item Lists", ja: "リストを開《ひら》く" },
  "practice.exerciseOf": { en: "Exercise {n} of {total}", ja: "{total}問《もん》中《ちゅう》{n}問目《もんめ》" },
  "practice.skipped": {
    en: "({count} Focus Set item{plural} without content, skipped)",
    ja: "（内容《ないよう》のない焦点《しょうてん》項目《こうもく》{count}件《けん》{plural}はスキップ）",
  },
  "practice.progressAria": { en: "Practice Session progress", ja: "練習《れんしゅう》セッションの進《すす》み" },
  "practice.continue": { en: "Continue", ja: "続行《ぞくこう》" },
  "practice.correct": { en: "Correct", ja: "正《ただ》しい" },
  "practice.notQuite": { en: "Not quite", ja: "惜《お》しい" },
  "practice.notQuiteAnswer": {
    en: "Not quite. Correct answer: {answer}",
    ja: "惜《お》しい。正解《せいかい》: {answer}",
  },
  "practice.destinationGrammar": { en: "Open Grammar Point", ja: "文法《ぶんぽう》ポイントを開《ひら》く" },
  "practice.destinationLists": { en: "Open Item Lists", ja: "リストを開《ひら》く" },
  "practice.sessionComplete": { en: "Session complete", ja: "セッション完了《かんりょう》" },
  "practice.scoreLine": {
    en: "{correct} of {total} correct - {count} exercise{plural} from your Focus Set.",
    ja: "焦点《しょうてん》セットから{count}問《もん》、{total}問《もん》答《こた》えて{correct}問《もん》正解《せいかい》{plural}。",
  },
  "practice.needsLook": { en: "Needs another look", ja: "再《ふたた》び見《み》直《なお》す" },
  "practice.correctAnswer": { en: "Correct answer: {answer}", ja: "正解《せいかい》: {answer}" },
  "practice.nothingToRevisit": {
    en: "Nothing to revisit this time.",
    ja: "今回《こんかい》、見《み》直《なお》す項目《こうもく》はありません。",
  },
  "practice.again": { en: "Practice again", ja: "もう一度《いちど》練習《れんしゅう》" },
  "item.kana": { en: "Kana", ja: "仮名《かな》" },
  "item.phrase": { en: "Phrase", ja: "フレーズ" },

  // The Grammar Catalogue (ui-plan 4.6, /grammar). JLPT levels (N5…N1) are data
  // and never translated; the level codes and MaruMori stay as-is in Japanese.
  "grammar.title": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "grammar.loadFailed": {
    en: "Cannot load grammar points: {message}",
    ja: "文法《ぶんぽう》ポイントを読《よ》み込《こ》せません: {message}",
  },
  "grammar.noSearchMatch": {
    en: "Nothing matches “{query}” — try another word.",
    ja: "“{query}”に合《あ》う文法《ぶんぽう》ポイントはありません。他《ほか》のことばを試《ため》してみてください。",
  },
  "grammar.clearSearch": { en: "Clear search", ja: "検索《けんさく》をクリア" },
  "grammar.noLevelPoints": {
    en: "No {level} Grammar Points in the catalogue.",
    ja: "カタログに{level}の文法《ぶんぽう》ポイントはありません。",
  },
  "grammar.showAllLevels": { en: "Show all levels", ja: "すべてのレベルを表示《ひょうじ》" },
  "grammar.emptyCatalogue": {
    en: "No grammar points yet — a MaruMori sync fills this catalogue.",
    ja: "まだ文法《ぶんぽう》ポイントがありません。MaruMoriの同期《どうき》でカタログが埋《う》まります。",
  },
  "grammar.pointCount": {
    en: "{count} Grammar Point{plural}",
    ja: "文法《ぶんぽう》ポイント{count}件《けん》{plural}。",
  },
  "grammar.searchLabel": { en: "Search grammar", ja: "文法《ぶんぽう》を検索《けんさく》" },
  "grammar.searchPlaceholder": {
    en: "Search pattern or meaning",
    ja: "パターンまたは意味《いみ》を検索《けんさく》",
  },
  "grammar.clearSearchAria": { en: "Clear search term", ja: "検索《けんさく》ワードをクリア" },
  "grammar.levelsAria": { en: "JLPT Levels", ja: "JLPTレベル" },
  "grammar.allLevels": { en: "All levels", ja: "すべてのレベル" },
  "grammar.statusSeeded": { en: "Seeded", ja: "シード済《ず》み" },
  "grammar.statusObserved": { en: "Observed", ja: "観察《かんさつ》済《ず》み" },
  "grammar.statusNotKnown": { en: "Not known", ja: "未知《みち》" },
  "grammar.pagesAria": { en: "Grammar pages", ja: "文法《ぶんぽう》ページ" },
  "grammar.pageRange": {
    en: "{from}–{to} of {total}",
    ja: "全《ぜん》{total}件《けん》の{from}〜{to}件目《けんめ》",
  },
  "grammar.exampleCount": { en: "{count} example{plural}", ja: "例《れい》文《ぶん》{count}件《けん》{plural}" },
  "grammar.backAria": { en: "Back to grammar", ja: "文法《ぶんぽう》へ戻《もど》る" },
  "grammar.notCataloguePoint": {
    en: "This is not a grammar point from the catalogue.",
    ja: "これはカタログの文法《ぶんぽう》ポイントではありません。",
  },
  "grammar.detailLoadFailed": {
    en: "Cannot load this grammar point: {message}",
    ja: "この文法《ぶんぽう》ポイントを読《よ》み込《こ》せません: {message}",
  },
  "grammar.generating": {
    en: "Preparing this page — the tutor writes a Grammar Point’s explanation the first time it is opened.",
    ja: "このページは準備《じゅんび》中《ちゅう》です — 教師《きょうし》は文法《ぶんぽう》ポイントの解説《せつめい》を、初《はじ》めて開《ひら》くときに書《か》きます。",
  },
  "grammar.explanation": { en: "Explanation", ja: "解説《せつめい》" },
  "grammar.explainFailed": {
    en: "The tutor could not generate this explanation. Check the AI Provider for grammar content in Settings, then reload this page.",
    ja: "教師《きょうし》はこの解説《せつめい》を生成《せいせい》できませんでした。設定《せってい》で文法《ぶんぽう》コンテンツのAIプロバイダを確認《かくにん》し、このページを読《よ》み直《なお》してください。",
  },
  "grammar.reload": { en: "Reload", ja: "読《よ》み直《なお》す" },
  "grammar.examples": { en: "Example sentences", ja: "例《れい》文《ぶん》" },
  "grammar.noValidatedExamples": {
    en: "No validated examples yet.",
    ja: "検証《けんしょう》済《ず》みの例《れい》文《ぶん》はまだありません。",
  },
  "grammar.alsoWritten": {
    en: "Also written {variants}",
    ja: "他《ほか》には{variants}とも書《か》かれます",
  },
} as const satisfies Record<string, { en: string; ja: string }>;

/** Every table entry key — the type-checked union `keyof typeof strings`. */
export type StringKey = keyof typeof strings;
