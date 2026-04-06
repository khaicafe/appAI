# OpenClaw Controller
<!-- cmd.exe /c "cd /d c:\appAI && npm start" -->
Ứng dụng Electron cơ bản để điều khiển OpenClaw.

## Chạy ứng dụng

1. `npm install`
2. `npm start`

## Build EXE Windows

1. Build NSIS `.exe` thông thường: `npm run dist:win`
2. Build `.exe` có chữ ký số: project mặc định dùng file `resources/certs/openclaw-controller-selfsigned.pfx` với password mặc định `123456`
3. Chạy: `npm run dist:win:signed`
4. Hoặc chạy một chạm bằng file `build-signed-win.bat`

Ví dụ PowerShell:

```powershell
$env:WIN_CERT_PASSWORD = '123456'
npm run dist:win:signed
```

Ví dụ file batch một chạm:

```bat
build-signed-win.bat "" "123456"
```

Nếu không truyền path và password, file `.bat` sẽ tự dùng cert mặc định trong project tại `resources/certs/openclaw-controller-selfsigned.pfx` với password `123456`.

File build sẽ nằm trong thư mục `release/`.

## Build và upload GitHub Release

1. Tăng `version` trong `package.json` nếu cần.
2. Bảo đảm `git` đã có quyền push `origin` và `git credential` đang lưu token GitHub hợp lệ.
3. Chạy `npm run release:publish`
4. Nếu muốn build signed rồi upload luôn, chạy `npm run release:publish:signed`

Script sẽ tự:

- build bản Windows mới
- dùng tag `v<version>` theo `package.json`
- push tag đó lên `origin` nếu chưa có
- tạo hoặc cập nhật GitHub Release tương ứng
- upload các file trong `release/`: `.exe`, `.blockmap`, `latest.yml`

Nếu chỉ muốn upload lại asset cho version hiện tại mà không build lại, chạy `npm run release:upload`.

Nếu build signed trên Windows bị lỗi liên quan tới `winCodeSign` hoặc `Cannot create symbolic link`, hãy chạy PowerShell bằng quyền Administrator hoặc bật Windows Developer Mode trước khi build.

Lưu ý: chữ ký số giúp giảm cảnh báo SmartScreen/antivirus, nhưng không bảo đảm hết cảnh báo ngay lập tức. Muốn uy tín tốt hơn trên Windows thường cần chứng thư code signing hợp lệ, tốt nhất là EV certificate hoặc certificate có reputation đủ lâu.

## Cấu trúc

- `src/main.js`: Main process và IPC handler
- `src/preload.js`: Context bridge bảo mật
- `src/renderer.js`: UI và gửi lệnh OpenClaw
- `src/index.html`: Giao diện điều khiển

## Mở rộng

Thay phần placeholder trong `src/main.js` bằng giao tiếp thực với OpenClaw qua serial, TCP, USB, hoặc API tuỳ theo thiết bị.

## Backup config

Nút `Backup config OpenClaw` sẽ mở hộp thoại chọn thư mục, sau đó chạy `openclaw backup create --only-config --verify --json --output <thu_muc>` để sao lưu file config đang active, hiện tại là `~/.openclaw/openclaw.json`.

## Gateway

Nút `Chạy Gateway` sẽ khởi động foreground process bằng `openclaw gateway run`. Nút `Dừng` sẽ dừng đúng process foreground mà ứng dụng đã spawn. Khi gateway sẵn sàng, ứng dụng sẽ tự mở dashboard tại `http://localhost:18789/`.
