package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/db"
)

// createUserCmd implements `server create-user --username NAME`. The password is read from
// an interactive prompt (no echo) or, when stdin is not a terminal, from its first line.
// It is deliberately not accepted as a flag: argv shows up in process lists and shell history.
func createUserCmd(ctx context.Context, cfg config.Config, args []string) error {
	username, err := parseCreateUserArgs(args)
	if err != nil {
		return err
	}
	password, err := promptPassword(os.Stdin, os.Stderr)
	if err != nil {
		return err
	}
	if err := auth.ValidateCredentials(username, password); err != nil {
		return err
	}

	// Safe to run before the server ever started: migrations are idempotent.
	if err := db.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	svc := auth.NewService(auth.NewPostgresStore(pool), auth.Options{TTL: cfg.SessionTTL})
	user, err := svc.CreateUser(ctx, username, password)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "created user %q (%s)\n", user.Username, user.ID)
	return nil
}

func parseCreateUserArgs(args []string) (string, error) {
	fs := flag.NewFlagSet("create-user", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	username := fs.String("username", "", "username of the account to create")
	if err := fs.Parse(args); err != nil {
		return "", fmt.Errorf("usage: server create-user --username NAME (password is read from stdin): %w", err)
	}
	if fs.NArg() > 0 || strings.TrimSpace(*username) == "" {
		return "", errors.New("usage: server create-user --username NAME (password is read from stdin)")
	}
	return *username, nil
}

func promptPassword(stdin *os.File, prompts io.Writer) (string, error) {
	if !term.IsTerminal(int(stdin.Fd())) {
		return readPasswordLine(stdin)
	}
	read := func(label string) (string, error) {
		fmt.Fprint(prompts, label)
		b, err := term.ReadPassword(int(stdin.Fd()))
		fmt.Fprintln(prompts)
		return string(b), err
	}
	first, err := read("Password: ")
	if err != nil {
		return "", err
	}
	second, err := read("Repeat password: ")
	if err != nil {
		return "", err
	}
	if first != second {
		return "", errors.New("passwords do not match")
	}
	return first, nil
}

// readPasswordLine returns the first line of r without its line ending.
func readPasswordLine(r io.Reader) (string, error) {
	line, err := bufio.NewReader(r).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return "", errors.New("no password provided on stdin")
	}
	return line, nil
}
