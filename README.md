# k8s-manifests — Order → Kafka → Notification trên Kubernetes + ArgoCD

## 1. Kiến trúc

```
curl POST /order ──► order-producer (Express, :3000) ──► Kafka (topic "orders") ──► notification-consumer
                      NodePort 30300                     StatefulSet, KRaft 1 node    in log "Nhận event..."
```

Cấu trúc repo:

```
argocd/application.yaml      # ArgoCD Application (KHÔNG nằm trong thư mục được sync)
k8s-manifests/               # thư mục ArgoCD theo dõi (path)
  kafka.yaml  producer.yaml  consumer.yaml
producer/  consumer/         # source code + Dockerfile
```

Thứ tự deploy được điều khiển bằng `sync-wave`: Kafka (wave 0) → producer/consumer (wave 1).

## 2. Yêu cầu

- Một cluster Kubernetes chạy được (minikube, kind, Docker Desktop, k3s, cloud...), tối thiểu ~2 GB RAM trống.
- `kubectl` đã trỏ đúng cluster: `kubectl get nodes`
- Image `luongmn15/order-producer:v1.0.0` và `luongmn15/notification-consumer:v1.0.0` phải **public** trên Docker Hub (hoặc cluster có imagePullSecret).

## 3. Cài ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# chờ tất cả Pod Running
kubectl get pods -n argocd -w
```

> Dùng `--server-side` vì CRD của ArgoCD lớn, `kubectl apply` thường sẽ lỗi "annotation too long".

## 4. Đăng nhập ArgoCD

```bash
# Terminal riêng, để chạy nền
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

Mở https://localhost:8080 (bỏ qua cảnh báo chứng chỉ). User: `admin`. Mật khẩu:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

(Tuỳ chọn) cài CLI `argocd` rồi: `argocd login localhost:8080 --username admin --insecure`

## 5. Triển khai ứng dụng

**Cách A — kubectl (khuyến nghị, đúng tinh thần GitOps):**

```bash
kubectl apply -f argocd/application.yaml
```

**Cách B — CLI:**

```bash
argocd app create order-notification \
  --repo https://github.com/luong-15/k8s-manifests.git \
  --revision main --path k8s-manifests \
  --dest-server https://kubernetes.default.svc --dest-namespace order-system \
  --sync-policy automated --auto-prune --self-heal \
  --sync-option CreateNamespace=true
```

**Cách C — UI:** `+ NEW APP` → Repository URL, Revision `main`, Path `k8s-manifests`,
Cluster `https://kubernetes.default.svc`, Namespace `order-system`, bật *Auto-Sync* + *Create Namespace*.

> Repo **private**: thêm repo trước bằng
> `argocd repo add https://github.com/luong-15/k8s-manifests.git --username <user> --password <GitHub PAT>`
> (hoặc Settings → Repositories trên UI).

## 6. Kiểm tra

```bash
kubectl get application -n argocd          # kỳ vọng: Synced / Healthy
kubectl get pods -n order-system           # kafka-0, order-producer-*, notification-consumer-*
argocd app get order-notification          # nếu dùng CLI
```

Pod `kafka-0` mất ~10–30 giây để Ready; producer/consumer đợi nhờ sync-wave và tự retry kết nối.

## 7. Test luồng end-to-end

```bash
# Terminal 1: theo dõi consumer
kubectl logs -f deploy/notification-consumer -n order-system

# Terminal 2: gọi API
kubectl port-forward svc/order-producer -n order-system 3000:3000
curl -X POST localhost:3000/order -H "Content-Type: application/json" \
     -d '{"item":"MacBook Pro","price":2500}'
```

Kỳ vọng: producer trả JSON `Tạo đơn hàng thành công!`, consumer in
`[CONSUMER 🔔] Nhận event -> ... đơn hàng #ORD-xxxx`.

Dùng NodePort 30300 trực tiếp: minikube → `minikube service order-producer -n order-system --url`;
kind → cần `extraPortMappings` khi tạo cluster, nên dùng port-forward cho đơn giản.

## 8. Cập nhật phiên bản (quy trình GitOps)

```bash
docker build -t luongmn15/order-producer:v1.0.1 ./producer
docker push luongmn15/order-producer:v1.0.1
# sửa tag image trong k8s-manifests/producer.yaml → v1.0.1
git add -A && git commit -m "producer v1.0.1" && git push
```

ArgoCD tự phát hiện (mặc định poll mỗi ~3 phút; bấm *Refresh/Sync* để chạy ngay).
Luôn dùng tag cố định, **không dùng `latest`**.

## 9. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `ImagePullBackOff` | Image không tồn tại / private | Kiểm tra tên-tag trên Docker Hub, đặt public hoặc tạo imagePullSecret |
| `kafka-0` CrashLoopBackOff | Thiếu RAM / cấu hình KRaft sai | `kubectl logs kafka-0 -n order-system`; tăng memory limit |
| Producer trả 503 "Kafka chưa sẵn sàng" | Kafka chưa Ready | Đợi, xem log producer (tự retry mỗi 3s) |
| App `OutOfSync` mãi | Ai đó sửa tay trong cluster | `selfHeal` đã bật; hoặc *Sync* thủ công |
| `path does not exist` | Sai `path` | Phải là `k8s-manifests` (thư mục con trong repo) |
| `ComparisonError` / repo not found | Repo private chưa add credential | Xem mục 5 |
| Xoá pod kafka mất dữ liệu | Chưa có PersistentVolume | Bình thường với demo; xem mục 10 |

## 10. Giới hạn của bản demo này

- Kafka 1 node, **không có volume** → restart pod là mất topic/message. Muốn giữ dữ liệu: thêm `volumeClaimTemplates` + mount vào `/var/lib/kafka/data` (và đặt `KAFKA_LOG_DIRS`, `fsGroup: 1000`).
- Image `kafka-native` là bản GraalVM; nếu gặp lỗi lạ có thể đổi sang `apache/kafka:3.8.0` (tăng memory limit lên ≥ 1Gi).
- Producer/consumer chạy `node:18-alpine` (Node 18 đã hết hỗ trợ) → nên nâng lên `node:20-alpine` hoặc `node:22-alpine`.
- Chưa có Ingress/TLS; chưa có CI tự build image.

## 11. Dọn dẹp

```bash
kubectl delete -f argocd/application.yaml     # finalizer sẽ xoá luôn tài nguyên trong order-system
kubectl delete namespace order-system         # nếu còn sót
```
