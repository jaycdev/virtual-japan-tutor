// Package migrations embeds the goose SQL migrations so they ship in the binary.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
