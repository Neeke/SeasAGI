//go:build darwin

package mitm

import (
	"fmt"
	"os/exec"
	"strings"
)

const darwinCertLabel = "SeasAGI MITM CA"

type darwinTrustInstaller struct {
	certLabel string
}

func newPlatformTrustInstaller() TrustInstaller {
	return &darwinTrustInstaller{certLabel: darwinCertLabel}
}

// NewTrustInstaller 是平台公共入口，返回当前平台的 TrustInstaller。
func NewTrustInstaller() TrustInstaller {
	return newPlatformTrustInstaller()
}

// Install 将 CA 证书安装到 macOS 系统钥匙串。
// 需要管理员权限（通过 osascript 提权）。
func (d *darwinTrustInstaller) Install(caPEM []byte) error {
	// 先检查是否已安装（幂等）
	if installed, _ := d.IsInstalled(); installed {
		return nil
	}

	// 将 PEM 写入临时文件
	tmpFile, err := writeTempPEM(caPEM)
	if err != nil {
		return fmt.Errorf("write temp PEM: %w", err)
	}
	defer removeTempFile(tmpFile)

	// security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain <cert>
	cmd := exec.Command("security", "add-trusted-cert", "-d", "-r", "trustRoot",
		"-k", "/Library/Keychains/System.keychain", tmpFile)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("security add-trusted-cert: %w: %s", err, string(output))
	}
	return nil
}

// Uninstall 从系统钥匙串卸载 CA 证书。
func (d *darwinTrustInstaller) Uninstall() error {
	cmd := exec.Command("security", "delete-certificate", "-c", d.certLabel)
	// 忽略 "certificate not found" 错误（幂等）
	if output, err := cmd.CombinedOutput(); err != nil {
		if !strings.Contains(string(output), "could not be found") {
			return fmt.Errorf("security delete-certificate: %w: %s", err, string(output))
		}
	}
	return nil
}

// IsInstalled 检查 CA 证书是否已安装在系统钥匙串中。
func (d *darwinTrustInstaller) IsInstalled() (bool, error) {
	cmd := exec.Command("security", "find-certificate", "-c", d.certLabel)
	if err := cmd.Run(); err != nil {
		// exit status 1 表示未找到
		return false, nil
	}
	return true, nil
}
