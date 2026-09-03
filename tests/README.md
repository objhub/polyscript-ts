# B-Rep リグレッションテスト

`tests/examples/*.poly` の全サンプルを実行し、B-Rep情報(BoundingBox、体積、
トポロジ)がスナップショットと一致するかを検証します。

Python実装とTypeScript実装が同じスナップショットを共有し、両実装の整合性を
確認します。

## ★ スナップショットは凍結オラクル (2026-09-01) ★

`snapshots/` は **Python 実装 (OCP 7.9.3.1 / OCCT 7.9.3) が生成したゴールデン
データで、2026-09-01 に凍結**した。Python は保守モードに入り
(`python/README.md`)、TypeScript が唯一の開発対象になったため、これらの
数値は **TS カーネルに対する独立した検算基盤** としての価値を持つ。

したがって**再生成は日常操作ではない**:

- スナップショットと TS の出力がずれたら、それは **TS カーネルの幾何が
  変わった**という意味。まず原因を調べる。再生成は原因究明の代わりにならない
- 再生成してよいのは、**意図的なモデル変更・カーネル更新のとき**だけ
  (例: 2026-09-01 の 12_gear インボリュート化、19_threaded_bolt 再設計)。
  そのときはコミットメッセージに理由を書く
- 凍結の事実・生成元バージョンは `snapshots/meta.json` の
  `frozen` / `oracle` に記録されている

同じ理由で、Python 実装そのものも当面削除しない
(独立オラクルとしての価値が実装の鮮度より重い)。

**2026-09-02 追記**: Python を実行せずに済む道筋を整えた。`generate_snapshots.ts` が
`poly info --json` からスナップショットを書き、`source` ブロックで出所を記録する。
`source` の無いスナップショットは Python オラクル産(正しさの証拠)、
`source.implementation = "typescript"` のものは変化検出用(人間が検証済みであることが前提)。
引退前の全モデル照合と、そこで見つかった Python 側の欠陥は `devel/parity-ledger202609.md`。

## ファイル構成

```
typescript/tests/
  examples/                  # 例題コーパス(26件)。live のギャラリーもここを参照する
    01_simple_box.poly
    ...
  snapshots/                 # 凍結ゴールデンデータ(Python OCP 7.9.3 生成)
    meta.json                #   凍結メタデータ(frozen/oracle/tolerance)
    01_simple_box.poly.json  #   example ファイル毎のスナップショット
    ...
  generate_snapshots.py      # 再生成(Python オラクル。意図的変更時のみ)
  generate_snapshots.ts      # 再生成(TypeScript。オラクルが評価できないときの代替。
                             #   `source` ブロック付きで出所を記録。変化検出であり正しさの保証ではない)
  binary_check.ts            # 出荷バイナリの info --json をスナップショットと照合(make binary-test)
  test_example.py            # Python 版テスト(pytest)
```

例題とスナップショットを同じリポジトリの同じ階層に置いているのは、**片方だけ
更新すると壊れる関係**だからです。2026-09-02 以前は例題が `live/public/example`、
スナップショットが `tests/regression/snapshots` と別リポジトリに分かれており、
例題を触ると別リポジトリのテストが黙って壊れる状態でした。

`live` 側は `public/example` をこのディレクトリへのシンボリックリンクとして
参照します。

TypeScript 版の照合は `packages/core/test/regression.test.ts`
(`snapshots/` と `examples/` を直接読む)。

## 実行方法

### TypeScript テスト

```bash
cd typescript && make fulltest        # Bun 実行(出荷ランタイム)
```

### Python テスト

```bash
cd python && uv run pytest ../typescript/tests/test_example.py -v
```

`cd python && make fulltest` からも実行されます。

### スナップショット再生成(意図的な形状変更時のみ)

```bash
cd python && uv run python ../typescript/tests/generate_snapshots.py
```

**全ファイルを上書きする**ので、1ファイルだけ変えたい場合は対象を絞って
実行するか、差分を確認してからコミットすること。

## 検証項目と許容誤差

| 項目 | 比較方法 | 許容誤差 |
|---|---|---|
| BoundingBox | 各軸のmin/max | ±0.1(絶対値) |
| 体積 | `BRepGProp.VolumeProperties` / `oc.getVolume` | ±1%(相対値) |
| トポロジー | B-RepのFace/Edge/Vertex数 | 完全一致 |

体積とBBoxはB-Rep上の解析的計算であり、STLテッセレーションに依存しません。
トポロジーもB-Repの面・エッジ・頂点の数なので、メッシュ分割の影響を受けません。

## 「落ちてよいテスト」は置かない

`KNOWN_FAILURES` と `it.fails` は 2026-09-02 に廃止しました。Python オラクルとの
差分は**直すバグか、更新するスナップショットのどちらか**であり、赤いまま置く
ものではありません(`devel/bun-migration202609.md` §5.2)。

過去に登録されていた 00_logo / 03_enclosure / 04_mount_plate / 09_chamfer_shell /
12_gear / 14_flange / 15_hex_nut / 17_shelf_bracket / 19_threaded_bolt / keyboard は
すべて解決済みです。最後まで残った 19_threaded_bolt は 2026-09-01 のモデル
再設計で解消しました。
