//go:build !linux

package internal

// HardenProcess is a no-op outside Linux; see harden_linux.go.
func HardenProcess() error { return nil }
