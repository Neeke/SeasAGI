package main

import (
	"log"
	"os"

	"github.com/seasagi/platform-api/cmd"
)

func main() {
	if err := cmd.Execute(); err != nil {
		log.Fatal(err)
		os.Exit(1)
	}
}
