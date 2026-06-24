import nodemailer from "nodemailer";
import type { EmailSender } from "../types";

/**
 * Production {@link EmailSender} backed by nodemailer SMTP. A fresh transport is
 * created per send — workflow sends are infrequent and this keeps no sockets
 * open between runs. Tests and dry runs inject a stub sender instead, so this
 * module (and a real SMTP connection) is never touched off the worker path.
 */
export const nodemailerSender: EmailSender = {
  async send(smtp, message) {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure ?? smtp.port === 465,
      auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? "" } : undefined,
    });

    const info = await transport.sendMail({
      from: message.from ?? smtp.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return {
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map((a) => (typeof a === "string" ? a : a.address)),
    };
  },
};
