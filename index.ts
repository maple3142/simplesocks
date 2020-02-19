// ref: https://github.com/gwuhaolin/blog/issues/12 https://gist.github.com/telamon/1127459 https://www.ietf.org/rfc/rfc1928.txt
// test: curl https://www.google.com.tw/ --socks5 localhost:4378
import { createServer, Socket, createConnection } from 'net'

const VERSION = 0x05
const HANDSHAKE_METHODS = {
	NOAUTH: 0x00,
	USERPASS: 0x02
}
const CMD_TYPE = {
	CONNECT: 0x01,
	BIND: 0x02,
	UDP: 0x03
}
const ADDRESS_TYPES = {
	IPV4: 0x01,
	DOMAINNAME: 0x03,
	IPV6: 0x04
}
const RESPONSE_REP = {
	SUCCEEDED: 0x00,
	GENERAL_FAILURE: 0x01,
	COMMAND_NOT_SUPPORTED: 0x07
}

const server = createServer(async socket => {
	try {
		await handleHandshake(socket)
		console.log('Handshake success!')
		const { cmd, address, port, request } = await handleConnect(socket)
		console.log('Connect success!')
		await proxyAndRespond(socket, cmd, address, port, request)
		console.log('Request complete!')
	} catch (e) {
		console.error('Someting went wrong during the request: ', e)
	}
})
function handleHandshake(socket: Socket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.once('data', chunk => {
			if (chunk[0] != VERSION) {
				socket.end()
				return reject('Invalid version')
			}
			const numMethods = chunk[1]
			const methods = chunk.slice(2, 2 + numMethods)
			if (!methods.includes(HANDSHAKE_METHODS.NOAUTH)) {
				socket.end()
				return reject("Client does't support no authentication")
			}
			const response = Buffer.alloc(2)
			response[0] = VERSION
			response[1] = HANDSHAKE_METHODS.NOAUTH
			socket.write(response)
			resolve()
		})
	})
}
function handleConnect(
	socket: Socket
): Promise<{ cmd: number; address: string; port: number; request: Buffer }> {
	return new Promise((resolve, reject) => {
		socket.once('data', chunk => {
			if (chunk[0] != VERSION) {
				socket.end()
				return reject('Invalid version')
			}
			const { address, size } = readAddress(chunk, 3) // ATYP starts from index=3
			const port = chunk.readInt16BE(3 + size + 1) // read DST.PORT
			const cmd = chunk[1]
			if (cmd === CMD_TYPE.CONNECT) {
				resolve({ cmd, address, port, request: chunk })
			} else {
				// other CMD currently unsupported
				const response = Buffer.alloc(chunk.length)
				chunk.copy(response)
				response[1] = RESPONSE_REP.COMMAND_NOT_SUPPORTED
				socket.end(response)
				return reject('Unsupported CMD')
			}
		})
	})
}
function readAddress(
	chunk: Buffer,
	offset: number
): { address: string; size: number } {
	if (chunk[offset] === ADDRESS_TYPES.IPV4) {
		// 4 bytes
		return {
			address: chunk.slice(offset + 1, offset + 5).join('.'),
			size: 4
		}
	} else if (chunk[offset] === ADDRESS_TYPES.DOMAINNAME) {
		const len = chunk[offset + 1] // first byte indicates (byte)length of the domain
		const domain = chunk.toString('utf-8', offset + 2, offset + 2 + len)
		return { address: domain, size: len }
	} else if (chunk[offset] === ADDRESS_TYPES.IPV6) {
		// 16 bytes
		let addr = ''
		for (let i = offset + 1; i < offset + 17; i += 2) {
			addr += chunk[i].toString(16) + chunk[i + 1].toString(16)
		}
		return { address: addr, size: 16 }
	}
	return null
}
function proxyAndRespond(
	socket: Socket,
	cmd: number,
	address: string,
	port: number,
	request: Buffer
) {
	return new Promise((resolve, reject) => {
		const response = Buffer.alloc(request.length)
		request.copy(response)
		const client = createConnection(port, address, () => {
			// connected
			response[1] = RESPONSE_REP.SUCCEEDED
			socket.write(response)
		})
		socket
			.pipe(client)
			.pipe(socket)
			.on('end', resolve)
		socket.on('error', reject)
		client.on('error', reject)
	})
}

const PORT = process.argv[2] || 4378
server.listen(PORT, () => console.log('Socks5 proxy listened on ' + PORT))
