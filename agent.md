# Android 打包与真机安装

以下命令在仓库根目录的 PowerShell 中运行。构建会使用当前工作区的源码，包含尚未提交的改动。

## 准备工具链

- Node.js 24 和 npm
- JDK 21
- Android SDK Platform 36、Build Tools 36.0.0 和 Platform Tools（含 ADB）
- Android NDK `28.2.13676358`（r28c）

按本机安装位置设置环境变量。以下示例使用 Android Studio 的默认 SDK 路径。

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk-21'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
```

构建脚本默认在 `$env:ANDROID_HOME\ndk\28.2.13676358` 查找 NDK。若 NDK 单独安装，将 `ANDROID_NDK_HOME` 指向包含 `toolchains` 的 NDK 根目录。

## 构建并检查调试 APK

首次构建或 `package-lock.json` 改动后运行 `npm.cmd ci`。首次运行 Android 构建还会下载并校验固定版本的 Node.js Mobile 运行库。Gradle Wrapper 使用仓库固定的 Gradle `8.14.3`，初次运行可能需要下载 Gradle 和项目依赖。

```powershell
npm.cmd run build:android
if ($LASTEXITCODE -ne 0) { throw 'Android assets build failed' }

.\android\gradlew.bat --project-dir android :app:assembleDebug --console=plain
if ($LASTEXITCODE -ne 0) { throw 'APK assembly failed' }

$apk = 'android/app/build/outputs/apk/debug/app-debug.apk'
$apksigner = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/apksigner.bat'
& $apksigner verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
Get-FileHash $apk -Algorithm SHA256
```

`npm.cmd run build:android` 会准备内嵌 Node.js 的 APK 构建输入（运行库和打包后的 `server.ts`）。界面是原生 Compose 代码，由 Gradle 直接编译；只有服务端（`server.ts`）或 Node 依赖变更后才需要重新运行这一步，再组装 APK。

## 覆盖安装到测试手机

手机开启 USB 调试并连接电脑。先运行 `devices -l`，在手机上允许 USB 调试授权，确认目标设备状态为 `device`。把下面的 `$serial` 替换为目标设备的实际序列号。

```powershell
$adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
& $adb devices -l

$serial = '<测试手机序列号>'
$apk = 'android/app/build/outputs/apk/debug/app-debug.apk'
& $adb -s $serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed' }

& $adb -s $serial shell am start -W -n com.radiflow.player/.MainActivity
& $adb -s $serial shell pidof com.radiflow.player
& $adb -s $serial shell dumpsys package com.radiflow.player | Select-String 'versionName=|lastUpdateTime='
```

安装应返回 `Success`，启动应返回 `Status: ok`，`pidof` 应返回运行中的进程号。`install -r` 用于保留已有应用数据。出现 `INSTALL_FAILED_USER_RESTRICTED` 时，解锁手机、允许 USB 安装提示后重试。出现 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 时，使用与已安装版本相同的签名重新构建。
