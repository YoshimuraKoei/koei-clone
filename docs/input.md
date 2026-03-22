# インプット

## EventBridge

Amazon EventBridge（昔は CloudWatch Events とも呼ばれていた系統）という AWS のマネージドサービスです。

- スケジュールルール（cron(...) や rate(...)）は EventBridge の機能で、「この時刻になったら」と決めた イベントを発火します。
- そのイベントの ターゲットとして Lambda 関数を指定すると、スケジュールのたびに EventBridge が Lambda を自動起動します。

補足: serverless.yml の events: - schedule: は、デプロイ時に EventBridge のルール＋Lambda への紐づけを CloudFormation 経由で作る、という関係になっています。
