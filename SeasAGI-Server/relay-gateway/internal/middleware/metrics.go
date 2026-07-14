package middleware

import (
	"net/http"
	"sync/atomic"

	"github.com/gin-gonic/gin"
)

var requestCount uint64
var errorCount uint64

func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		atomic.AddUint64(&requestCount, 1)
		c.Next()
		if c.Writer.Status() >= http.StatusBadRequest {
			atomic.AddUint64(&errorCount, 1)
		}
	}
}

func MetricsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"requests_total": atomic.LoadUint64(&requestCount),
		"errors_total":   atomic.LoadUint64(&errorCount),
	})
}
