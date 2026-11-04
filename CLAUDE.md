# スタジオ練出欠管理

## 用語
- ユーザーに見える文字列（LINE内アプリ・参加リンクのページ・Bot の返事・LINE のカード・docs/ の案内文）は、[docs/glossary.md](docs/glossary.md) の用語集に従って書く。
- 用語集にない新しい言葉が要るときは、先に用語集へ足してから使う（足し方は用語集の最後にある）。
- 用語集の「使わない言い方」を見つけたら、決まった言葉に直す。

## デザイン
- LINE内アプリ・参加リンクのページの見た目と動きは、[docs/design.md](docs/design.md) の決まりに従う。
- 色・文字の大きさ・角丸は `apps/liff/src/styles.css` 先頭のトークンから選び、値を直接書かない。新しい部品を作る前に、決まりにある部品を使う。
- 決まりにない見た目が要るときは、先に docs/design.md を直してから使う。
- 画面に関わる変更は、PR を出す前に管理者にモックで触ってもらい、OK をもらう。

## リリース
- 新しいバージョンを出すときは、[.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md) の手順に従う（番号・CHANGELOG.md・タグ・GitHub Release）。
- 公開する文（CHANGELOG・タグ・Release・コミット）には、使っているグループの名前や「仲間内」のような内輪の言い方を書かない。
