#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
// goTrayMenuClick 由 cgo 的 //export 从 tray_darwin.go 导出。
// _cgo_export.h 仅在 cgo 构建的临时目录中生成、源码目录中不存在，
// 直接 include 会让 IDE/clangd 报 file not found——改为 extern 声明，
// 真实构建时链接器从 cgo 生成的桥接代码解析该符号。
extern void goTrayMenuClick(int tag);

@interface TrayDelegate : NSObject
@end

@implementation TrayDelegate
- (void)menuItemClicked:(id)sender {
    NSInteger tag = [(NSMenuItem *)sender tag];
    goTrayMenuClick((int)tag);
}
@end

static TrayDelegate *delegate = NULL;
static NSStatusItem *statusItem = NULL;

void createTray(void *iconData, int iconLen) {
	dispatch_async(dispatch_get_main_queue(), ^{
		static dispatch_once_t once;
		dispatch_once(&once, ^{
			delegate = [[TrayDelegate alloc] init];
		});

		statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];

		if (iconData != NULL && iconLen > 0) {
			NSData *data = [NSData dataWithBytes:iconData length:(NSUInteger)iconLen];
			NSImage *img = [[NSImage alloc] initWithData:data];
			if (img) {
				[img setTemplate:YES];
				[statusItem.button setImage:img];
			}
		}
		if (statusItem.button.title.length == 0 && statusItem.button.image == nil) {
			[statusItem.button setTitle:@"S"];
		}
		[statusItem.button setToolTip:@"SeasAGI - 本地大模型通道切换客户端"];
		[statusItem setMenu:[[NSMenu alloc] init]];
	});
}

// ponytail: nil 检查必须放在 dispatch block 内——statusItem 由 createTray 在主队列
// 异步赋值，调用线程同步判断时它几乎必然还是 NULL，会静默丢弃所有菜单项。
// 主队列 FIFO 保证 createTray 的 block 先于本 block 执行。
void addTrayItem(const char *title, int tag, int isSeparator, int isChecked) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (statusItem == nil) return;
		if (isSeparator) {
			[statusItem.menu addItem:[NSMenuItem separatorItem]];
		} else {
			NSString *label = [NSString stringWithUTF8String:title];
			NSMenuItem *mi = [[NSMenuItem alloc] initWithTitle:label action:@selector(menuItemClicked:) keyEquivalent:@""];
			[mi setTag:tag];
			[mi setTarget:delegate];
			if (isChecked) {
				[mi setState:NSControlStateValueOn];
			}
			[statusItem.menu addItem:mi];
		}
	});
}

void clearTrayMenu() {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (statusItem == nil) return;
		[statusItem.menu removeAllItems];
	});
}

// ponytail: statusItem 的读写必须全部收敛到主队列——此前在调用线程同步置 nil，
// 与主队列 block 中的读形成数据竞争；主队列 FIFO 同时保证销毁前已入队的
// 菜单操作仍能安全执行，销毁后入队的自然 no-op。
void destroyTray() {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (statusItem == nil) return;
		[[NSStatusBar systemStatusBar] removeStatusItem:statusItem];
		statusItem = nil;
	});
}