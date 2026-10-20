package main

import (
	"bufio"
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"scopearr"
	"scopearr/internal/app"
	"strings"
	"syscall"
	"time"
)

var version = ""

func main() {
	if version == "" {
		version = scopearr.Version()
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		client := &http.Client{Timeout: 3 * time.Second}
		res, err := client.Get("http://127.0.0.1:8080/healthz")
		if err != nil {
			os.Exit(1)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	configureMemoryLimit()
	dir := settingEnv("SCOPEARR_DATA_DIR")
	if dir == "" {
		dir = "/data"
	}
	store, err := app.OpenStore(dir)
	if err != nil {
		log.Fatal(err)
	}
	defer store.DB.Close()
	if len(os.Args) > 1 && os.Args[1] == "reset-password" {
		sec, err := app.NewSecurity(store)
		if err != nil {
			log.Fatal(err)
		}
		password, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && password == "" {
			log.Fatal("Enter the new password on stdin")
		}
		if err = sec.Reset(strings.TrimRight(password, "\r\n")); err != nil {
			log.Fatal(err)
		}
		log.Print("Password changed; all sessions ended")
		return
	}
	if settingEnv("SCOPEARR_DEMO") == "true" {
		if err := app.SeedDemo(store); err != nil {
			log.Fatal(err)
		}
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	server, err := app.NewServer(ctx, store, scopearr.Assets(), version)
	if err != nil {
		log.Fatal(err)
	}
	server.Demo = settingEnv("SCOPEARR_DEMO") == "true"
	server.StartBackground(ctx)
	addr := settingEnv("SCOPEARR_LISTEN")
	if addr == "" {
		addr = ":8080"
	}
	httpServer := &http.Server{Addr: addr, Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		<-ctx.Done()
		shutdownCtx, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		httpServer.Shutdown(shutdownCtx)
	}()
	log.Printf("Scopearr %s listening on %s · optional media editing is controlled by Settings → Services", version, addr)
	if !server.Security.Initialized() {
		log.Print("Ersteinrichtung: Code aus /data/setup-token (SCOPEARR_DATA_DIR/setup-token) verwenden")
	}
	if err = httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	cancel()
	server.WaitBackground()
	server.Sync.Shutdown()
}

func settingEnv(key string) string { return os.Getenv(key) }
