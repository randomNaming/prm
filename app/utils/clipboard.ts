/**
 * 复制文本到剪贴板。
 *
 * 内网常用 http://192.168.x.x 访问，不是安全上下文，async clipboard API 不存在，
 * 所以准备好 execCommand 的兜底 —— 两个分支都试，全失败才算失败。
 */
export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard && window.isSecureContext) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// 权限被拒等场景，落到底下的兜底再试一次。
		}
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.select();

	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {
		ok = false;
	}

	document.body.removeChild(textarea);
	return ok;
}
