package main

import (
	"log"
	"os"

	"github.com/SeasAGI/SeasAGI-Server/relay-gateway/cmd"
)

func main() {
	if err := cmd.Execute(); err != nil {
		log.Fatal(err)
		os.Exit(1)
	}
}
