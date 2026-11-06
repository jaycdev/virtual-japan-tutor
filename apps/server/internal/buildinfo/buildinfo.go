// Package buildinfo holds the version this binary was built as. The image build sets it with
// -ldflags "-X .../buildinfo.Version=<version>" (apps/server/Dockerfile); local builds keep "unknown".
package buildinfo

// Version is a release such as 1.2.3 or 1.2.3-rc.1, dev+<short commit> for builds of main, or unknown.
var Version = "unknown"
