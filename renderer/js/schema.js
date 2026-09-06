// schema.js — シナリオコマンドの定義。
// エディタのフォーム自動生成と、プレイヤー(engine.js)側の解釈仕様の「仕様書」を兼ねる。
// ここに書かれた type 文字列は player-template/js/engine.js の実装と対応している。

(function (global) {
  // フィールド種別:
  //  text        : 一行テキスト入力
  //  textarea    : 複数行テキスト入力
  //  number      : 数値入力
  //  boolean     : チェックボックス
  //  select      : 選択式( options で指定 )
  //  asset:CATEGORY : 取り込み済みアセットからの選択( bg/char/bgm/se/voice )
  //  charRef     : 登録済みキャラクターからの選択
  //  varRef      : 登録済み変数からの選択
  //  sceneRef    : シーン一覧からの選択

  const COMMAND_TYPES = {
    text: {
      label: '💬 セリフ・地の文',
      fields: [
        { key: 'speaker', label: '話者名(空欄で地の文)', type: 'text' },
        { key: 'body', label: '本文', type: 'textarea', required: true },
        { key: 'voice', label: 'ボイス', type: 'asset:voice' }
      ]
    },
    bg: {
      label: '🖼️ 背景を変更',
      fields: [
        { key: 'image', label: '背景画像', type: 'asset:bg', required: true },
        { key: 'transition', label: '切り替え効果', type: 'select', options: ['fade', 'none'], default: 'fade' },
        { key: 'duration', label: '効果の時間(秒)', type: 'number', default: 0.6 }
      ]
    },
    char_show: {
      label: '🧍 立ち絵を表示',
      fields: [
        { key: 'charId', label: 'キャラクター', type: 'charRef', required: true },
        { key: 'image', label: '表情/差分画像', type: 'asset:char', required: true },
        { key: 'position', label: '表示位置', type: 'select', options: ['left', 'center', 'right'], default: 'center' },
        { key: 'transition', label: '切り替え効果', type: 'select', options: ['fade', 'none'], default: 'fade' },
        { key: 'duration', label: '効果の時間(秒)', type: 'number', default: 0.4 }
      ]
    },
    char_hide: {
      label: '🚶 立ち絵を退場',
      fields: [
        { key: 'charId', label: 'キャラクター', type: 'charRef', required: true },
        { key: 'transition', label: '切り替え効果', type: 'select', options: ['fade', 'none'], default: 'fade' },
        { key: 'duration', label: '効果の時間(秒)', type: 'number', default: 0.4 }
      ]
    },
    bgm_play: {
      label: '🎵 BGMを再生',
      fields: [
        { key: 'file', label: 'BGMファイル', type: 'asset:bgm', required: true },
        { key: 'loop', label: 'ループ再生', type: 'boolean', default: true },
        { key: 'fadeIn', label: 'フェードイン(秒)', type: 'number', default: 1 }
      ]
    },
    bgm_stop: {
      label: '🔇 BGMを停止',
      fields: [
        { key: 'fadeOut', label: 'フェードアウト(秒)', type: 'number', default: 1 }
      ]
    },
    se_play: {
      label: '🔔 効果音を再生',
      fields: [
        { key: 'file', label: '効果音ファイル', type: 'asset:se', required: true }
      ]
    },
    voice_play: {
      label: '🗣️ ボイスを再生',
      fields: [
        { key: 'file', label: 'ボイスファイル', type: 'asset:voice', required: true }
      ]
    },
    set_var: {
      label: '🔢 変数を変更',
      fields: [
        { key: 'key', label: '変数', type: 'varRef', required: true },
        { key: 'op', label: '操作', type: 'select', options: ['=', '+=', '-=', '*=', '/=', 'toggle'], default: '=' },
        { key: 'valueType', label: '値の種類', type: 'select', options: ['number', 'string', 'boolean', 'expression'], default: 'number' },
        { key: 'value', label: '値', type: 'text' }
      ]
    },
    choice: {
      label: '🔀 選択肢を表示',
      isChoice: true,
      fields: []
    },
    jump: {
      label: '↪️ シーン移動(ジャンプ)',
      fields: [
        { key: 'target', label: '移動先シーン', type: 'sceneRef', required: true },
        { key: 'condition', label: '条件式(空欄なら常に実行)', type: 'text' }
      ]
    },
    end: {
      label: '🏁 ゲーム終了(タイトルへ)',
      fields: []
    }
  };

  const COMMAND_ORDER = ['text', 'bg', 'char_show', 'char_hide', 'bgm_play', 'bgm_stop', 'se_play', 'voice_play', 'set_var', 'choice', 'jump', 'end'];

  global.VN_SCHEMA = { COMMAND_TYPES, COMMAND_ORDER };
})(window);
