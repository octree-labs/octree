//go:build linux

package internal

import "syscall"

// HardenProcess marks the service process non-dumpable. The TeX engines run
// as the same uid, so without this a document could read
// /proc/1/environ (SUPABASE_JWT_SECRET) or /proc/1/mem with LuaTeX's
// io.open or pdfTeX's \openin, bypassing the child-environment allowlist.
// A non-dumpable process's /proc entries need CAP_SYS_PTRACE to read, which
// the container does not have. Children exec with the default (dumpable)
// flag, so latexmk and the engines are unaffected.
func HardenProcess() error {
	if _, _, errno := syscall.Syscall(syscall.SYS_PRCTL, syscall.PR_SET_DUMPABLE, 0, 0); errno != 0 {
		return errno
	}
	return nil
}
